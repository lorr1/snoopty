/**
 * Token Breakdown Analyzer
 *
 * Computes detailed per-role token breakdowns using Anthropic's token counting API.
 * This integrates tokenCounting.ts functionality into the analyzer framework.
 */

import type {
  InteractionLog,
  TokenCountDetail,
  TokenUsageSegmentId,
  TokenUsageSummary,
} from '../../shared/types';
import { logger } from '../logger';
import {
  countAssistantTokens,
  countSystemTokens,
  countToolTokens,
  countUserTokens,
} from '../utils/tokenCounter';
import type { MetricsAnalyzer } from './MetricsAnalyzer';

interface InputBuckets {
  system: string[];
  user: string[];
  assistant: string[];
  thinking: string[];
  tool_return: string[];
  tool_use: string[];
}

interface OutputBuckets {
  assistant: string[];
  thinking: string[];
  tool_use: string[];
}

const EMPTY_INPUT_BUCKETS = (): InputBuckets => ({
  system: [],
  user: [],
  assistant: [],
  thinking: [],
  tool_return: [],
  tool_use: [],
});

const EMPTY_OUTPUT_BUCKETS = (): OutputBuckets => ({
  assistant: [],
  thinking: [],
  tool_use: [],
});

export class TokenBreakdownAnalyzer implements MetricsAnalyzer<TokenUsageSummary> {
  name = 'token-breakdown';

  async analyze(log: InteractionLog): Promise<TokenUsageSummary | null> {
    // Only analyze /messages endpoints
    if (!log.path.includes('/messages')) {
      logger.debug(
        { logId: log.id, path: log.path },
        'TokenBreakdownAnalyzer: Skipping - path does not include /messages'
      );
      return null;
    }

    logger.info(
      { logId: log.id, path: log.path },
      'TokenBreakdownAnalyzer: Starting analysis'
    );

    try {
      return await this.computeTokenUsageSummary(log);
    } catch (error) {
      logger.error({ logId: log.id, error }, 'TokenBreakdownAnalyzer: Failed to compute token breakdown');
      return null;
    }
  }

  private async computeTokenUsageSummary(
    entry: InteractionLog
  ): Promise<TokenUsageSummary | null> {
    const inputBuckets = EMPTY_INPUT_BUCKETS();
    const outputBuckets = EMPTY_OUTPUT_BUCKETS();

    this.collectRequestBuckets(entry, inputBuckets);
    this.collectResponseBuckets(entry, outputBuckets);

    const hasInputContent = Object.values(inputBuckets).some((segments) => segments.length > 0);
    const hasOutputContent = Object.values(outputBuckets).some((segments) => segments.length > 0);

    if (!hasInputContent && !hasOutputContent) {
      return null;
    }

    const body = entry.request.body as Record<string, unknown> | undefined;
    const model = body?.model;

    if (!model || typeof model !== 'string') {
      throw new Error('Model is required in request body for token counting');
    }

    const tools = body?.tools as unknown[] | undefined;

    // Run all token counting API calls in parallel
    const [
      inputSystemDetail,
      inputUserDetail,
      inputAssistantDetail,
      inputThinkingDetail,
      inputToolDetail,
      inputToolReturnDetail,
      inputToolUseDetail,
      outputAssistantDetail,
      outputThinkingDetail,
      outputToolUseDetail,
    ] = await Promise.all([
      this.buildDetail('system', inputBuckets.system, model),
      this.buildDetail('user', inputBuckets.user, model),
      this.buildDetail('assistant', inputBuckets.assistant, model),
      this.buildDetail('thinking', inputBuckets.thinking, model),
      this.buildDetail('tool', [], model, tools),
      this.buildDetail('tool_return', inputBuckets.tool_return, model),
      this.buildDetail('tool_use', inputBuckets.tool_use, model),
      this.buildDetail('assistant', outputBuckets.assistant, model),
      this.buildDetail('thinking', outputBuckets.thinking, model),
      this.buildDetail('tool_use', outputBuckets.tool_use, model),
    ]);

    const systemUsage = entry.tokenUsage.system_totals;

    const inputSegments: Record<string, TokenCountDetail> = {
      system: inputSystemDetail,
      user: inputUserDetail,
      assistant: inputAssistantDetail,
      thinking: inputThinkingDetail,
      tool: inputToolDetail,
      tool_return: inputToolReturnDetail,
      tool_use: inputToolUseDetail,
    };

    const outputSegments: Record<string, TokenCountDetail> = {
      assistant: outputAssistantDetail,
      thinking: outputThinkingDetail,
      tool_use: outputToolUseDetail,
    };

    // Calculate totals
    let inputTokensTotal: number | null = 0;
    for (const detail of Object.values(inputSegments)) {
      if (typeof detail.tokens === 'number') {
        inputTokensTotal += detail.tokens;
      } else {
        inputTokensTotal = null;
        break;
      }
    }

    let outputTokensTotal: number | null = 0;
    for (const detail of Object.values(outputSegments)) {
      if (typeof detail.tokens === 'number') {
        outputTokensTotal += detail.tokens;
      } else {
        outputTokensTotal = null;
        break;
      }
    }

    const totalTokens =
      inputTokensTotal !== null && outputTokensTotal !== null
        ? inputTokensTotal + outputTokensTotal
        : null;

    return {system_totals: systemUsage, custom: {
        provider: 'estimate',
        methodology: 'estimate',
        input: {
          segments: inputSegments,
          totalTokens: inputTokensTotal,
        },
        output: {
          segments: outputSegments,
          totalTokens: outputTokensTotal,
        },
        totalTokens,
      }
    };
  }

  private async buildDetail(
    role: TokenUsageSegmentId,
    textSegments: string[],
    model: string,
    tools?: unknown[]
  ): Promise<TokenCountDetail> {
    if (role !== 'tool' && textSegments.length === 0) {
      return {
        tokens: 0,
        textLength: 0,
        segments: 0,
        methodology: 'estimate',
      };
    }

    let tokens = 0;
    let textLength = 0;
    let segments = 0;
    const combined = textSegments.join('\n');

    try {
      switch (role) {
        case 'system':
          tokens = await countSystemTokens(model, combined);
          textLength = combined.length;
          segments = textSegments.length;
          break;
        case 'user':
        case 'tool_return':
          tokens = await countUserTokens(model, combined);
          textLength = combined.length;
          segments = textSegments.length;
          break;
        case 'assistant':
        case 'thinking':
        case 'tool_use':
          tokens = await countAssistantTokens(model, combined);
          textLength = combined.length;
          segments = textSegments.length;
          break;
        case 'tool':
          if (tools && Array.isArray(tools) && tools.length > 0) {
            tokens = await countToolTokens(model, tools);
            textLength = JSON.stringify(tools).length;
            segments = tools.length;
          }
          break;
        default:
          logger.warn({ role }, 'Unknown role in buildDetail');
      }
    } catch (error) {
      logger.error({ role, error }, 'Failed to count tokens');
      throw error;
    }

    return {
      tokens,
      textLength,
      segments,
      methodology: 'estimate',
    };
  }

  private addIfPresent(bucket: string[], value: unknown): void {
    if (typeof value === 'string' && value.trim().length > 0) {
      bucket.push(value);
    }
  }

  private normalizeContentByType(content: unknown): {
    text: string[];
    thinking: string[];
    tool_use: string[];
    tool_result: string[];
  } {
    const result = {
      text: [],
      thinking: [],
      tool_use: [],
      tool_result: [],
    } as {
      text: string[];
      thinking: string[];
      tool_use: string[];
      tool_result: string[];
    };

    if (typeof content === 'string') {
      result.text.push(content);
      return result;
    }

    if (Array.isArray(content)) {
      for (const item of content) {
        if (typeof item === 'string') {
          result.text.push(item);
        } else if (item && typeof item === 'object' && 'type' in item) {
          const value = item as Record<string, unknown>;
          if (value.type === 'thinking' && 'thinking' in value && typeof value.thinking === 'string') {
            result.thinking.push(value.thinking);
          } else if (value.type === 'tool_use') {
            const value_with_relevant_fields = {
              name: value.name,
              input: value.input,
            };
            result.tool_use.push(JSON.stringify(value_with_relevant_fields));
          } else if (value.type === 'tool_result') {
            if ('content' in value) {
              if (typeof value.content === 'string') {
                result.tool_result.push(value.content);
              } else {
                result.tool_result.push(JSON.stringify(value.content));
              }
            }
          } else if (value.type === 'text' && 'text' in value && typeof value.text === 'string') {
            result.text.push(value.text);
          }
        }
      }
      return result;
    }

    if (content && typeof content === 'object' && 'type' in content) {
      const value = content as Record<string, unknown>;
      if (value.type === 'thinking' && 'thinking' in value && typeof value.thinking === 'string') {
        result.thinking.push(value.thinking);
      } else if (value.type === 'tool_use') {
        result.tool_use.push(JSON.stringify(value));
      } else if (value.type === 'tool_result') {
        if ('content' in value) {
          if (typeof value.content === 'string') {
            result.tool_result.push(value.content);
          } else {
            result.tool_result.push(JSON.stringify(value.content));
          }
        }
      } else if (value.type === 'text' && 'text' in value && typeof value.text === 'string') {
        result.text.push(value.text);
      }
    }

    return result;
  }

  private collectRequestBuckets(entry: InteractionLog, buckets: InputBuckets): void {
    const body = entry.request.body;
    if (!body || typeof body !== 'object') {
      return;
    }

    const data = body as Record<string, unknown>;
    const system = data.system;

    if (Array.isArray(system)) {
      for (const item of system) {
        if (item && typeof item === 'object' && 'text' in (item as Record<string, unknown>)) {
          this.addIfPresent(buckets.system, String((item as Record<string, unknown>).text));
        } else if (typeof item === 'string') {
          this.addIfPresent(buckets.system, item);
        }
      }
    } else if (typeof system === 'string') {
      this.addIfPresent(buckets.system, system);
    }

    const messages = data.messages;
    if (Array.isArray(messages)) {
      for (const raw of messages) {
        if (!raw || typeof raw !== 'object') {
          continue;
        }
        const message = raw as { role?: string; content?: unknown };
        const role = typeof message.role === 'string' ? message.role : 'assistant';
        const contentByType = this.normalizeContentByType(message.content);

        switch (role) {
          case 'user':
            for (const segment of contentByType.text) {
              this.addIfPresent(buckets.user, segment);
            }
            for (const segment of contentByType.tool_result) {
              this.addIfPresent(buckets.tool_return, segment);
            }
            break;
          case 'assistant':
            for (const segment of contentByType.text) {
              this.addIfPresent(buckets.assistant, segment);
            }
            for (const segment of contentByType.thinking) {
              this.addIfPresent(buckets.thinking, segment);
            }
            for (const segment of contentByType.tool_use) {
              this.addIfPresent(buckets.tool_use, segment);
            }
            break;
        }
      }
    }
  }

  private collectResponseBuckets(entry: InteractionLog, buckets: OutputBuckets): void {
    if (!entry.response) {
      return;
    }

    const { body, streamChunks } = entry.response;

    if (body && typeof body === 'object') {
      const content = (body as Record<string, unknown>).content;
      if (Array.isArray(content)) {
        const contentByType = this.normalizeContentByType(content);
        for (const segment of contentByType.text) {
          this.addIfPresent(buckets.assistant, segment);
        }
        for (const segment of contentByType.thinking) {
          this.addIfPresent(buckets.thinking, segment);
        }
        for (const segment of contentByType.tool_use) {
          this.addIfPresent(buckets.tool_use, segment);
        }
      }
    } else if (Array.isArray(streamChunks)) {
      for (const chunk of streamChunks) {
        const lines = chunk.split('\n');
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) {
            continue;
          }
          const payload = line.slice(5).trim();
          if (!payload) {
            continue;
          }
          try {
            const parsed = JSON.parse(payload) as Record<string, unknown>;
            if (parsed.type === 'content_block_delta') {
              const delta = parsed.delta as Record<string, unknown> | undefined;
              if (delta) {
                if (typeof delta.text === 'string') {
                  this.addIfPresent(buckets.assistant, delta.text);
                } else if (typeof delta.thinking === 'string') {
                  this.addIfPresent(buckets.thinking, delta.thinking);
                }
              }
            } else if (parsed.type === 'content_block_start') {
              const contentBlock = parsed.content_block as Record<string, unknown> | undefined;
              if (contentBlock?.type === 'tool_use') {
                this.addIfPresent(buckets.tool_use, JSON.stringify(contentBlock));
              }
            }
          } catch {
            // ignore malformed entries
          }
        }
      }
    }
  }
}
