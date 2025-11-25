/**
 * Token Counter Utility
 *
 * Provides a general-purpose abstraction for counting tokens using Anthropic's API.
 * This replaces the inline counting logic in tokenCounting.ts and can be reused
 * across all metrics analyzers.
 *
 * Design principles:
 * - ALWAYS use Anthropic's official token counting API for accuracy
 * - NEVER estimate - throw errors if API is unavailable
 * - Support batching/parallelization for performance
 */

import { appConfig } from '../config';

/**
 * Base interface for token counting requests.
 */
interface TokenCountRequest {
  model: string;
  system?: string;
  userMessage?: string;
  assistantMessage?: string;
  tools?: unknown[];
}

/**
 * Call Anthropic's token counting API with the given parameters.
 *
 * @param request - The token counting request parameters
 * @returns The input token count from Anthropic's API
 * @throws Error if the API call fails
 */
export async function callAnthropicTokenCountAPI(
  request: TokenCountRequest
): Promise<number> {
  const { model, system, userMessage, assistantMessage, tools } = request;

  const messages: Array<{ role: string; content: string }> = [];

  if (userMessage) {
    messages.push({ role: 'user', content: userMessage });
  }

  if (assistantMessage) {
    messages.push({ role: 'assistant', content: assistantMessage });
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

  if (system) {
    requestBody.system = system;
  }

  if (tools && tools.length > 0) {
    requestBody.tools = tools;
  }

  const response = await fetch(`${appConfig.upstreamBaseUrl}/v1/messages/count_tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': appConfig.upstreamApiKey || '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new Error(`Token count API failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { input_tokens: number };
  return data.input_tokens;
}

/**
 * Count tokens for system prompt by comparing with and without system.
 * Uses differential counting to isolate the system prompt's contribution.
 */
export async function countSystemTokens(
  model: string,
  systemPrompt: string
): Promise<number> {
  if (!systemPrompt) {
    return 0;
  }

  const withSystem = await callAnthropicTokenCountAPI({
    model,
    system: systemPrompt,
    userMessage: 'Hi',
  });

  const withoutSystem = await callAnthropicTokenCountAPI({
    model,
    userMessage: 'Hi',
  });

  return withSystem - withoutSystem;
}

/**
 * Count tokens for a user message.
 */
export async function countUserTokens(model: string, userMessage: string): Promise<number> {
  if (!userMessage) {
    return 0;
  }

  return await callAnthropicTokenCountAPI({
    model,
    userMessage,
  });
}

/**
 * Count tokens for an assistant message.
 */
export async function countAssistantTokens(
  model: string,
  assistantMessage: string
): Promise<number> {
  if (!assistantMessage) {
    return 0;
  }

  return await callAnthropicTokenCountAPI({
    model,
    assistantMessage,
  });
}

/**
 * Count tokens for tools by comparing with and without tools.
 * Uses "Hi" for both system and user as baseline (matching Python implementation).
 */
export async function countToolTokens(
  model: string,
  tools: unknown[] | undefined
): Promise<number> {
  if (!tools || tools.length === 0) {
    return 0;
  }

  const withTools = await callAnthropicTokenCountAPI({
    model,
    system: 'Hi',
    userMessage: 'Hi',
    tools,
  });

  const withoutTools = await callAnthropicTokenCountAPI({
    model,
    system: 'Hi',
    userMessage: 'Hi',
  });

  return withTools - withoutTools;
}

/**
 * Count tokens for arbitrary text content using the user message API.
 * This is a general-purpose method for counting any text content.
 *
 * @param model - The model to use for token counting
 * @param content - The text content to count tokens for
 * @returns The token count
 * @throws Error if the API call fails
 */
export async function countContentTokens(model: string, content: string): Promise<number> {
  if (!content) {
    return 0;
  }

  return await countUserTokens(model, content);
}

/**
 * Batch count tokens for multiple content strings in parallel.
 *
 * This is more efficient than calling countContentTokens repeatedly
 * when you have many items to count.
 *
 * @param model - The model to use for token counting
 * @param contents - Array of text content to count
 * @returns Array of token counts (same order as input)
 * @throws Error if any API call fails
 */
export async function batchCountContentTokens(
  model: string,
  contents: string[]
): Promise<number[]> {
  return await Promise.all(contents.map((content) => countContentTokens(model, content)));
}

/**
 * Count tokens for a map of named content strings.
 * Returns a map with the same keys and token counts as values.
 *
 * Useful for counting multiple named segments (e.g., tool results by name).
 *
 * @param model - The model to use for token counting
 * @param contentMap - Map of name to content
 * @returns Map of name to token count
 * @throws Error if any API call fails
 */
export async function countNamedContents(
  model: string,
  contentMap: Map<string, string>
): Promise<Map<string, number>> {
  const entries = Array.from(contentMap.entries());
  const counts = await batchCountContentTokens(
    model,
    entries.map(([, content]) => content)
  );

  const result = new Map<string, number>();
  entries.forEach(([name], index) => {
    const count = counts[index];
    if (count !== undefined) {
      result.set(name, count);
    }
  });

  return result;
}
