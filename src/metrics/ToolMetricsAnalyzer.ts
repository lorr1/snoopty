/**
 * Tool Metrics Analyzer
 *
 * Extracts and computes metrics about tool usage from interaction logs:
 * - Which tools are defined
 * - Which tools are called (tool_use blocks)
 * - Tool return sizes (tool_result blocks) using ACCURATE token counts via Anthropic API
 * - Frequency and aggregate statistics
 *
 * IMPORTANT: All size metrics are in TOKENS, not string lengths.
 * Uses the shared tokenCounter utility for accuracy.
 */

import type { InteractionLog, ToolMetricsSummary, ToolUsageDetail } from '../../shared/types';
import { logger } from '../logger';
import { countContentTokens } from '../utils/tokenCounter';
import type { MetricsAnalyzer } from './MetricsAnalyzer';

export class ToolMetricsAnalyzer implements MetricsAnalyzer<ToolMetricsSummary> {
  name = 'tool-metrics';

  async analyze(log: InteractionLog): Promise<ToolMetricsSummary | null> {
    // Only analyze /messages endpoints
    // Skip /messages/count_tokens since it's just for token counting
    if (!log.path.includes('/messages')) {
      logger.debug(
        { logId: log.id, path: log.path },
        'ToolMetricsAnalyzer: Skipping - path does not include /messages'
      );
      return null;
    }

    if (log.path.includes('/count_tokens')) {
      logger.debug(
        { logId: log.id, path: log.path },
        'ToolMetricsAnalyzer: Skipping - path includes /count_tokens'
      );
      return null;
    }

    const body = log.request.body as Record<string, unknown> | undefined;
    const model = body?.model;

    if (!model || typeof model !== 'string') {
      logger.warn(
        { logId: log.id, path: log.path },
        'ToolMetricsAnalyzer: Skipping - missing model in request body'
      );
      return null;
    }

    logger.info(
      { logId: log.id, path: log.path, model },
      'ToolMetricsAnalyzer: Starting analysis'
    );

    const toolUsage = new Map<string, ToolUsageDetail>();

    // 1. Extract tool definitions from request
    const toolDefinitions = this.extractToolDefinitions(log);
    for (const toolName of toolDefinitions) {
      if (!toolUsage.has(toolName)) {
        toolUsage.set(toolName, {
          toolName,
          callCount: 0,
          totalReturnTokens: 0,
          avgReturnTokens: 0,
          maxReturnTokens: 0,
          minReturnTokens: null,
          returnTokenCounts: []
        });
      }
    }

    // 2. Extract tool_use blocks from response (assistant calls tools)
    const toolCalls = this.extractToolCalls(log);
    for (const toolName of toolCalls) {
      if (!toolUsage.has(toolName)) {
        toolUsage.set(toolName, {
          toolName,
          callCount: 0,
          totalReturnTokens: 0,
          avgReturnTokens: 0,
          maxReturnTokens: 0,
          minReturnTokens: null,
          returnTokenCounts: []
        });
      }
      const detail = toolUsage.get(toolName)!;
      detail.callCount++;
    }

    // 3. Extract tool_result blocks from request and count tokens
    try {
      const toolResults = await this.extractAndCountToolResults(log, model);
      for (const { toolName, tokenCount } of toolResults) {
        if (!toolUsage.has(toolName)) {
          // Tool result without prior definition (shouldn't happen, but handle it)
          toolUsage.set(toolName, {
            toolName,
            callCount: 0,
            totalReturnTokens: 0,
            avgReturnTokens: 0,
            maxReturnTokens: 0,
            minReturnTokens: null,
            returnTokenCounts: []
          });
        }
        const detail = toolUsage.get(toolName)!;
        detail.totalReturnTokens += tokenCount;
        detail.returnTokenCounts.push(tokenCount);
        detail.maxReturnTokens = Math.max(detail.maxReturnTokens, tokenCount);
        detail.minReturnTokens =
          detail.minReturnTokens === null
            ? tokenCount
            : Math.min(detail.minReturnTokens, tokenCount);
      }
    } catch (error) {
      logger.error({ logId: log.id, error }, 'Failed to count tool result tokens');
      throw error;
    }

    // 4. Compute averages
    for (const detail of toolUsage.values()) {
      if (detail.returnTokenCounts.length > 0) {
        detail.avgReturnTokens = detail.totalReturnTokens / detail.returnTokenCounts.length;
      }
    }

    // If no tools found, return null
    if (toolUsage.size === 0) {
      return null;
    }

    const toolDetails = Array.from(toolUsage.values());

    return {
      totalToolsAvailable: toolDefinitions.size,
      totalToolCalls: toolDetails.reduce((sum, d) => sum + d.callCount, 0),
      totalToolResults: toolDetails.reduce((sum, d) => sum + d.returnTokenCounts.length, 0),
      tools: toolDetails
    };
  }

  /**
   * Extract tool definitions from request body.
   */
  private extractToolDefinitions(log: InteractionLog): Set<string> {
    const toolNames = new Set<string>();

    try {
      const body = log.request.body as any;
      if (body && Array.isArray(body.tools)) {
        for (const tool of body.tools) {
          if (tool && typeof tool.name === 'string') {
            toolNames.add(tool.name);
          }
        }
      }
    } catch (error) {
      // Ignore parsing errors
    }

    return toolNames;
  }

  /**
   * Extract tool_use blocks from response content.
   */
  private extractToolCalls(log: InteractionLog): string[] {
    const toolNames: string[] = [];

    try {
      const body = log.response?.body as any;
      if (body && Array.isArray(body.content)) {
        for (const block of body.content) {
          if (block && block.type === 'tool_use' && typeof block.name === 'string') {
            toolNames.push(block.name);
          }
        }
      }
    } catch (error) {
      // Ignore parsing errors
    }

    return toolNames;
  }

  /**
   * Extract tool_result blocks from request messages and count their tokens.
   *
   * Uses Anthropic's token counting API for accuracy via the shared tokenCounter utility.
   *
   * Returns array of { toolName, tokenCount } where tokenCount is the actual
   * token count from Anthropic API.
   */
  private async extractAndCountToolResults(
    log: InteractionLog,
    model: string
  ): Promise<Array<{ toolName: string; tokenCount: number }>> {
    const results: Array<{ toolName: string; content: string }> = [];

    try {
      const body = log.request.body as any;
      if (body && Array.isArray(body.messages)) {
        for (const message of body.messages) {
          if (message && Array.isArray(message.content)) {
            for (const block of message.content) {
              if (block && block.type === 'tool_result') {
                // Try to find the tool name by matching tool_use_id
                const toolName = this.inferToolNameFromResult(log, block.tool_use_id);
                if (toolName) {
                  const content = this.extractToolResultContent(block);
                  results.push({ toolName, content });
                }
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error({ logId: log.id, error }, 'Error extracting tool results');
      throw error;
    }

    // Count tokens for all tool results in parallel using the shared utility
    const countedResults = await Promise.all(
      results.map(async ({ toolName, content }) => {
        const tokenCount = await countContentTokens(model, content);
        return { toolName, tokenCount };
      })
    );

    return countedResults;
  }

  /**
   * Extract content from a tool_result block as a string.
   */
  private extractToolResultContent(toolResultBlock: any): string {
    try {
      if (typeof toolResultBlock.content === 'string') {
        return toolResultBlock.content;
      } else {
        return JSON.stringify(toolResultBlock.content);
      }
    } catch (error) {
      return '';
    }
  }

  /**
   * Infer tool name from tool_use_id by looking at response content and request messages.
   * Searches both the current response and previous assistant messages in the request.
   */
  private inferToolNameFromResult(log: InteractionLog, toolUseId: string): string | null {
    try {
      // First check the response (current turn)
      const responseBody = log.response?.body as any;
      if (responseBody && Array.isArray(responseBody.content)) {
        for (const block of responseBody.content) {
          if (
            block &&
            block.type === 'tool_use' &&
            block.id === toolUseId &&
            typeof block.name === 'string'
          ) {
            return block.name;
          }
        }
      }

      // Also check request messages (previous turns in conversation)
      const requestBody = log.request.body as any;
      if (requestBody && Array.isArray(requestBody.messages)) {
        for (const message of requestBody.messages) {
          if (message && message.role === 'assistant' && Array.isArray(message.content)) {
            for (const block of message.content) {
              if (
                block &&
                block.type === 'tool_use' &&
                block.id === toolUseId &&
                typeof block.name === 'string'
              ) {
                return block.name;
              }
            }
          }
        }
      }
    } catch (error) {
      // Ignore
    }

    // Fallback: return the tool_use_id as the name
    // (Not ideal, but better than dropping the data)
    return toolUseId || null;
  }
}
