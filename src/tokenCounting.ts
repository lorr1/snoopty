import { inspect } from 'util';
import { appConfig } from './config';
import type {
  CustomTokenUsage,
  InteractionLog,
  TokenCountDetail,
  TokenUsageSegmentId,
  InputSegmentId,
  OutputSegmentId,
  TokenBreakdown,
} from './logWriter';

/**
 * `tokenCounting.ts` uses Anthropic's token counting API to determine how many tokens
 * each role (system, user, assistant, tool, cache) contributed.
 *
 * The flow is:
 *  1. Bucket request/response text by role,
 *  2. Call Anthropic's API to count tokens for each bucket,
 *  3. Return a `CustomTokenUsage` structure that mirrors the rest of the logging API.
 */

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

/**
 * Simple heuristic fallback when the official API is unavailable.
 */
function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.max(1, Math.ceil(text.length / 4.2));
}

/**
 * Call Anthropic's token counting API
 */
async function callAnthropicTokenCountAPI(
  model: string,
  systemPrompt: string,
  userMessage: string,
  modelMessage: string,
  tools: unknown[] | undefined
): Promise<number> {
  const messages: Array<{
    role: string;
    content: string;
  }> = [];

  if (userMessage) {
    messages.push({ role: 'user', content: userMessage });
  }

  if (modelMessage) {
    messages.push({ role: 'assistant', content: modelMessage });
  }

  const requestBody: {
    model: string;
    system?: string;
    messages: Array<{ role: string; content: string }>;
    tools?: unknown[];
  } = {
    model,
    messages: messages.length > 0 ? messages : [{ role: 'user', content: 'Hi' }],
  };

  if (systemPrompt) {
    requestBody.system = systemPrompt;
  }

  if (tools && tools.length > 0) {
    requestBody.tools = tools;
  }

  const startTime = Date.now();
  const response = await fetch(`${appConfig.upstreamBaseUrl}/v1/messages/count_tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': appConfig.upstreamApiKey || '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(requestBody),
  });

  const duration = Date.now() - startTime;

  if (!response.ok) {
    throw new Error(`Token count API failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { input_tokens: number };
  return data.input_tokens;
}

/**
 * Count tokens for system prompt by comparing with and without system
 */
async function countSystemTokens(
  model: string,
  systemPrompt: string
): Promise<number> {
  if (!systemPrompt) {
    return 0;
  }
  
  const withSystem = await callAnthropicTokenCountAPI(
    model,
    systemPrompt,
    'Hi',
    '',
    undefined
  );
  const withoutSystem = await callAnthropicTokenCountAPI(model, '', 'Hi', '', undefined);
  return withSystem - withoutSystem;
}

/**
 * Count tokens for user message
 */
async function countUserTokens(
  model: string,
  userMessage: string
): Promise<number> {
  if (!userMessage) {
    return 0;
  }
  const userTokenCount = await callAnthropicTokenCountAPI(model, '', userMessage, '', undefined);
  return userTokenCount;
}

/**
 * Count tokens for assistant message
 */
async function countAssistantTokens(
  model: string,
  assistantMessage: string
): Promise<number> {
  if (!assistantMessage) {
    return 0;
  }

  return await callAnthropicTokenCountAPI(model, '', '', assistantMessage, undefined);
}

/**
 * Count tokens for tools by comparing with and without tools
 * Uses "Hi" for both system and user as baseline (matching Python implementation)
 */
async function countToolTokens(
  model: string,
  tools: unknown[] | undefined
): Promise<number> {
  if (!tools || tools.length === 0) {
    return 0;
  }
  const withTools = await callAnthropicTokenCountAPI(model, 'Hi', 'Hi', '', tools);
  const withoutTools = await callAnthropicTokenCountAPI(model, 'Hi', 'Hi', '', undefined);

  return withTools - withoutTools;
}

function addIfPresent(bucket: string[], value: unknown): void {
  if (typeof value === 'string' && value.trim().length > 0) {
    bucket.push(value);
  }
}

interface MessageContent {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

interface Message {
  role?: string;
  content?: unknown;
  [key: string]: unknown;
}

interface ThinkingContent {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

interface ToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content: unknown;
}

type ContentItem = string | MessageContent | ThinkingContent | ToolUseContent | ToolResultContent;

interface ContentByType {
  text: string[];
  thinking: string[];
  tool_use: string[];
  tool_result: string[];
}

function normalizeContentByType(content: unknown): ContentByType {
  const result: ContentByType = {
    text: [],
    thinking: [],
    tool_use: [],
    tool_result: [],
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
          // Extract the name an input of the value to use for JSON.stringify
          const value_with_relevant_fields: Record<string, unknown> = {
            name: value.name,
            input: value.input,
          };
          result.tool_use.push(JSON.stringify(value_with_relevant_fields));
        } else if (value.type === 'tool_result') {
          // Extract the content from tool_result
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

function collectRequestBuckets(entry: InteractionLog, buckets: InputBuckets): void {
  const body = entry.request.body;
  if (!body || typeof body !== 'object') {
    return;
  }

  const data = body as Record<string, unknown>;
  const { tools, ...dataWithoutTools } = data;
  console.log(
    '[Laurel] Counting custom request data\n',
    inspect(dataWithoutTools, { depth: null, colors: true, compact: false })
  );
  if (tools) {
    const toolSummary = Array.isArray(tools)
      ? { tools_count: tools.length }
      : { tools_type: typeof tools };
    console.log('[Laurel] request data tools omitted from dump', toolSummary);
  }
  const system = data.system;
  if (Array.isArray(system)) {
    for (const item of system) {
      if (item && typeof item === 'object' && 'text' in (item as Record<string, unknown>)) {
        addIfPresent(buckets.system, String((item as Record<string, unknown>).text));
      } else if (typeof item === 'string') {
        addIfPresent(buckets.system, item);
      }
    }
  } else if (typeof system === 'string') {
    addIfPresent(buckets.system, system);
  }

  const messages = data.messages;
  if (Array.isArray(messages)) {
    for (const raw of messages) {
      if (!raw || typeof raw !== 'object') {
        continue;
      }
      const message = raw as Message;
      const role = typeof message.role === 'string' ? message.role : 'assistant';
      const contentByType = normalizeContentByType(message.content);
      switch (role) {
        case 'user':
          for (const segment of contentByType.text) {
            addIfPresent(buckets.user, segment);
          }
          // Tool results come in user messages
          for (const segment of contentByType.tool_result) {
            addIfPresent(buckets.tool_return, segment);
          }
          break;
        case 'assistant':
          for (const segment of contentByType.text) {
            addIfPresent(buckets.assistant, segment);
          }
          // Thinking blocks come in assistant messages
          for (const segment of contentByType.thinking) {
            addIfPresent(buckets.thinking, segment);
          }
          // Tool use blocks come in assistant messages
          for (const segment of contentByType.tool_use) {
            addIfPresent(buckets.tool_use, segment);
          }
          break;
        case 'tool':
          // Tools are under data.tools, not in messages
          throw new Error('Unexpected tool role in request messages');
        default:
          console.log('[Laurel] !!!unknown message role, treating as assistant', { role });
          throw new Error(`Unexpected message role: ${role}`);
      }
    }
  }
}

function collectResponseBuckets(entry: InteractionLog, buckets: OutputBuckets): void {
  if (!entry.response) {
    return;
  }
  console.log(
    '[Laurel] Counting custom response data\n',
    inspect(entry.response.body, { depth: null, colors: true, compact: false })
  );
  const { body, streamChunks } = entry.response;
  if (body && typeof body === 'object') {
    console.log('[Laurel] processing response body for token counting');
    const content = (body as Record<string, unknown>).content;
    if (Array.isArray(content)) {
      const contentByType = normalizeContentByType(content);
      // Response is always from assistant
      for (const segment of contentByType.text) {
        addIfPresent(buckets.assistant, segment);
      }
      for (const segment of contentByType.thinking) {
        addIfPresent(buckets.thinking, segment);
      }
      for (const segment of contentByType.tool_use) {
        addIfPresent(buckets.tool_use, segment);
      }
    }
  }
  // Only look at streamChunks if body is not present
  else if (Array.isArray(streamChunks)) {
    console.log('[Laurel] processing stream chunks for token counting');
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
                addIfPresent(buckets.assistant, delta.text);
              } else if (typeof delta.thinking === 'string') {
                addIfPresent(buckets.thinking, delta.thinking);
              }
            }
          } else if (parsed.type === 'content_block_start') {
            const contentBlock = parsed.content_block as Record<string, unknown> | undefined;
            if (contentBlock?.type === 'tool_use') {
              addIfPresent(buckets.tool_use, JSON.stringify(contentBlock));
            }
          }
        } catch {
          // ignore malformed entries
        }
      }
    }
  }
}

async function buildDetail(
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
        tokens = await countUserTokens(model, combined);
        textLength = combined.length;
        segments = textSegments.length;
        break;
      case 'assistant':
        tokens = await countAssistantTokens(model, combined);
        textLength = combined.length;
        segments = textSegments.length;
        break;
      case 'thinking':
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
      case 'tool_return':
        tokens = await countUserTokens(model, combined);
        textLength = combined.length;
        segments = textSegments.length;
        break;
      case 'tool_use':
        // Cache tokens would need special handling
        tokens = await countAssistantTokens(model, combined);
        textLength = combined.length;
        segments = textSegments.length;
        break;
      default:
        console.log('[Laurel] !!!unknown role in buildDetail', { role });
        tokens = 0;
        textLength = 0;
        segments = 0;
    }
  } catch (error) {
    console.error(`Failed to count tokens for ${role}:`, error);
    throw error;
  }

  console.log('[Laurel] Token counting detail', { role, tokens, textSegments });
  return {
    tokens,
    textLength,
    segments,
    methodology: 'estimate',
  };
}

export async function computeCustomTokenUsage(
  entry: InteractionLog
): Promise<CustomTokenUsage | undefined> {
  // Separate buckets for input (request) and output (response)
  const inputBuckets = EMPTY_INPUT_BUCKETS();
  const outputBuckets = EMPTY_OUTPUT_BUCKETS();

  // Collect from request into input buckets
  collectRequestBuckets(entry, inputBuckets);
  // Collect from response into output buckets
  collectResponseBuckets(entry, outputBuckets);

  const hasInputContent = Object.values(inputBuckets).some((segments) => segments.length > 0);
  const hasOutputContent = Object.values(outputBuckets).some((segments) => segments.length > 0);

  if (!hasInputContent && !hasOutputContent) {
    return undefined;
  }

  const body = entry.request.body as Record<string, unknown> | undefined;
  const model = body?.model;

  if (!model || typeof model !== 'string') {
    throw new Error('Model is required in request body for token counting');
  }

  const tools = body?.tools as unknown[] | undefined;

  // Run all token counting API calls in parallel for better performance
  // Input segments from request
  const [
    inputSystemDetail,
    inputUserDetail,
    inputAssistantDetail,
    inputThinkingDetail,
    inputToolDetail,
    inputToolReturnDetail,
    inputToolUseDetail,
    // Output segments from response
    outputAssistantDetail,
    outputThinkingDetail,
    outputToolUseDetail,
  ] = await Promise.all([
    buildDetail('system', inputBuckets.system, model),
    buildDetail('user', inputBuckets.user, model),
    buildDetail('assistant', inputBuckets.assistant, model),
    buildDetail('thinking', inputBuckets.thinking, model),
    buildDetail('tool', [], model, tools),
    buildDetail('tool_return', inputBuckets.tool_return, model),
    buildDetail('tool_use', inputBuckets.tool_use, model),
    buildDetail('assistant', outputBuckets.assistant, model),
    buildDetail('thinking', outputBuckets.thinking, model),
    buildDetail('tool_use', outputBuckets.tool_use, model),
  ]);

  // Build input breakdown (what goes into the model from request)
  const inputSegments: Record<string, TokenCountDetail> = {
    system: inputSystemDetail,
    user: inputUserDetail,
    assistant: inputAssistantDetail,
    thinking: inputThinkingDetail,
    tool: inputToolDetail,
    tool_return: inputToolReturnDetail,
    tool_use: inputToolUseDetail,
  };

  // Build output breakdown (what the model generates in response)
  const outputSegments: Record<string, TokenCountDetail> = {
    assistant: outputAssistantDetail,
    thinking: outputThinkingDetail,
    tool_use: outputToolUseDetail,
  };

  // Calculate input total
  let inputTokensTotal: number | null = 0;
  for (const detail of Object.values(inputSegments)) {
    if (typeof detail.tokens === 'number') {
      inputTokensTotal += detail.tokens;
    } else {
      inputTokensTotal = null;
      break;
    }
  }

  // Calculate output total
  let outputTokensTotal: number | null = 0;
  for (const detail of Object.values(outputSegments)) {
    if (typeof detail.tokens === 'number') {
      outputTokensTotal += detail.tokens;
    } else {
      outputTokensTotal = null;
      break;
    }
  }

  // Calculate overall total
  const totalTokens =
    inputTokensTotal !== null && outputTokensTotal !== null
      ? inputTokensTotal + outputTokensTotal
      : null;

  return {
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
  };
}
