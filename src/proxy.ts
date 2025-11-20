import type { Request, Response as ExpressResponse } from 'express';
import type {
  BodyInit as UndiciBodyInit,
  RequestInit as UndiciRequestInit,
  Response as UndiciResponse,
} from 'undici';
import type { ReadableStream as NodeReadableStream } from 'stream/web';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { fetch } from 'undici';
import { appConfig } from './config';
import { logger } from './logger';
import { InteractionLog, sanitizeHeaders, writeInteractionLog } from './logWriter';
import { AnthropicStreamAggregator } from './streamAggregator';

/**
 * This module owns the reverse proxy. Every inbound Express request to /v1/* is
 * forwarded to Anthropic. On the way out we persist request/response metadata so
 * the UI and Parquet export have a complete log.
 *
 * The code mirrors a plain HTTP proxy:
 *  - construct the upstream request (headers, body),
 *  - stream the upstream response back to the caller,
 *  - record summary information regardless of success or failure.
 */

const METHODS_WITHOUT_BODY = new Set(['GET', 'HEAD']);

function buildUpstreamUrl(originalUrl: string): string {
  return new URL(originalUrl, appConfig.upstreamBaseUrl).toString();
}

function shouldForwardBody(method: string, body: unknown): boolean {
  if (METHODS_WITHOUT_BODY.has(method.toUpperCase())) {
    return false;
  }
  if (body === undefined || body === null) {
    return false;
  }
  if (typeof body === 'object' && !Array.isArray(body)) {
    return Object.keys(body as Record<string, unknown>).length > 0;
  }
  if (Array.isArray(body)) {
    return body.length > 0;
  }
  if (typeof body === 'string') {
    return body.length > 0;
  }
  return true;
}

function serializeRequestBody(req: Request): UndiciBodyInit | null {
  if (!shouldForwardBody(req.method, req.body)) {
    return null;
  }

  if (typeof req.body === 'string') {
    return req.body;
  }

  if (Buffer.isBuffer(req.body)) {
    return req.body as unknown as UndiciBodyInit;
  }

  try {
    return JSON.stringify(req.body) as unknown as UndiciBodyInit;
  } catch {
    return null;
  }
}

function extractQuery(originalUrl: string): string {
  const queryIndex = originalUrl.indexOf('?');
  return queryIndex === -1 ? '' : originalUrl.slice(queryIndex + 1);
}

/**
 * Forward a single request to Anthropic while capturing enough data to replay it later.
 * The proxy never throws: network failures are surfaced as 502 responses to the caller
 * and captured in the log file.
 */
export async function proxyAnthropicRequest(
  req: Request,
  res: ExpressResponse
): Promise<void> {
  const interactionId = randomUUID();
  const upstreamUrl = buildUpstreamUrl(req.originalUrl);
  const startTime = Date.now();

  const logEntry: InteractionLog = {
    id: interactionId,
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    query: extractQuery(req.originalUrl),
    request: {
      headers: sanitizeHeaders(req.headers as Record<string, string | string[] | undefined>),
      body: req.body,
    },
  };

  const controller = new AbortController();
  // When the client disconnects we abort the upstream fetch so we do not leak sockets.
  res.on('close', () => controller.abort());

  const upstreamHeaders = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'undefined') {
      continue;
    }

    const lowerKey = key.toLowerCase();
    if (lowerKey === 'host' || lowerKey === 'content-length') {
      continue;
    }

    const headerValue = Array.isArray(value) ? value.join(',') : value;
    upstreamHeaders.set(lowerKey, headerValue);
  }

  if (appConfig.upstreamApiKey) {
    upstreamHeaders.set('x-api-key', appConfig.upstreamApiKey);
  }

  const upstreamRequestInit: UndiciRequestInit = {
    method: req.method,
    headers: upstreamHeaders,
    signal: controller.signal,
  };

  const serializedBody = serializeRequestBody(req);
  if (serializedBody !== null) {
    upstreamRequestInit.body = serializedBody;
  }

  logger.info(
    {
      id: interactionId,
      method: req.method,
      url: upstreamUrl,
    },
    'proxying request to Anthropic'
  );

  try {
    const upstreamResponse = await fetch(upstreamUrl, upstreamRequestInit);
    const contentType = upstreamResponse.headers.get('content-type') ?? '';

    res.status(upstreamResponse.status);
    upstreamResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'content-length') {
        return;
      }
      res.setHeader(key, value);
    });

    const responseHeaders: Record<string, string | string[] | undefined> = {};
    upstreamResponse.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });

    logEntry.response = {
      status: upstreamResponse.status,
      headers: sanitizeHeaders(responseHeaders),
    };

    if (contentType.includes('text/event-stream')) {
      await handleStreamResponse(upstreamResponse, res, logEntry);
    } else {
      await handleStandardResponse(upstreamResponse, res, logEntry);
    }

    logEntry.durationMs = Date.now() - startTime;
    logger.info(
      {
        id: interactionId,
        method: req.method,
        status: upstreamResponse.status,
        durationMs: logEntry.durationMs,
      },
      'proxied request completed'
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'unknown upstream error';

    logger.error(
      {
        err: error,
        id: interactionId,
      },
      'proxy request failed'
    );

    if (!res.headersSent) {
      res.status(502).json({
        error: 'Failed to reach Anthropic upstream service.',
        details: message,
      });
    } else {
      res.end();
    }

    logEntry.response = {
      status: 502,
      headers: {},
      error: message,
    };
    logEntry.durationMs = Date.now() - startTime;
  } finally {
    await writeInteractionLog(logEntry);
  }
}

async function handleStandardResponse(
  upstreamResponse: UndiciResponse,
  res: ExpressResponse,
  logEntry: InteractionLog
): Promise<void> {
  // For JSON/text responses we buffer the body once so we can both return it to the
  // caller and include it in the saved interaction record.
  const buffer = Buffer.from(await upstreamResponse.arrayBuffer());
  res.send(buffer);

  const contentType = upstreamResponse.headers.get('content-type') ?? '';
  if (!logEntry.response) {
    return;
  }

  if (contentType.includes('application/json')) {
    try {
      logEntry.response.body = JSON.parse(buffer.toString('utf8'));
      return;
    } catch {
      // fall through to plain text representation
    }
  }

  logEntry.response.body = buffer.toString('utf8');
}

async function handleStreamResponse(
  upstreamResponse: UndiciResponse,
  res: ExpressResponse,
  logEntry: InteractionLog
): Promise<void> {
  // Anthropic streams event-source chunks. We stream them straight back to the caller
  // while also capturing the text fragments for later inspection in the UI.
  const stream = upstreamResponse.body
    ? Readable.fromWeb(
        upstreamResponse.body as unknown as NodeReadableStream<Uint8Array>
      )
    : null;

  if (!stream) {
    res.end();
    if (logEntry.response) {
      logEntry.response.streamChunks = [];
    }
    return;
  }

  res.flushHeaders?.();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  const aggregator = new AnthropicStreamAggregator();

  for await (const chunk of stream) {
    const buffer =
      typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
    res.write(buffer);

    const piece = decoder.decode(buffer, { stream: true });
    if (piece.length > 0) {
      chunks.push(piece);
      aggregator.ingest(piece);
    }
  }

  const finalPiece = decoder.decode();
  if (finalPiece.length > 0) {
    chunks.push(finalPiece);
    aggregator.ingest(finalPiece);
  }

  res.end();

  if (logEntry.response) {
    logEntry.response.streamChunks = chunks;
    const aggregatedMessage = aggregator.finalize();
    if (aggregatedMessage) {
      logEntry.response.body = aggregatedMessage;
    }
  }
}
