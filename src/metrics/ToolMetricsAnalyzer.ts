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

import type { InteractionLog, ToolCallDetail, ToolMetricsSummary, ToolUsageDetail } from '../../shared/types';
import { logger } from '../logger';
import { countContentTokens } from '../utils/tokenCounter';
import type { MetricsAnalyzer } from './MetricsAnalyzer';

export class ToolMetricsAnalyzer implements MetricsAnalyzer<ToolMetricsSummary> {
  name = 'tool-metrics';

  /**
   * Classify tool as MCP or regular based on naming convention.
   * MCP tools start with 'mcp__' or are named 'ListMcpResourcesTool' or 'ReadMcpResourceTool'.
   */
  private classifyToolType(toolName: string): 'mcp' | 'regular' {
    return toolName.startsWith('mcp__')
      ? 'mcp'
      : 'regular';
  }

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
    const toolCallDetails: ToolCallDetail[] = [];

    // 1. Extract tool definitions from request
    const toolDefinitions = this.extractToolDefinitions(log);
    for (const toolName of toolDefinitions) {
      if (!toolUsage.has(toolName)) {
        toolUsage.set(toolName, {
          toolName,
          callCount: 0,
          totalReturnTokens: 0,
          returnTokenCounts: []
        });
      }
    }

    // 2. Extract tool_use blocks from response (for counting NEW calls)
    const toolCallsInResponse = this.extractToolCallsWithIds(log);
    for (const { toolCallId, toolName } of toolCallsInResponse) {
      if (!toolUsage.has(toolName)) {
        toolUsage.set(toolName, {
          toolName,
          callCount: 0,
          totalReturnTokens: 0,
          returnTokenCounts: []
        });
      }
      const detail = toolUsage.get(toolName)!;
      detail.callCount++;
    }

    // 3. Extract COMPLETED tool calls from REQUEST
    // In the request, we have both tool_use (from previous turn) and tool_result blocks
    // Extract them together to get complete records with return tokens
    try {
      const completedToolCalls = await this.extractCompletedToolCallsFromRequest(log, model);

      for (const { toolCallId, toolName, timestamp, returnTokens } of completedToolCalls) {
        // Add to toolCallDetails array with ID
        toolCallDetails.push({
          toolCallId,
          toolName,
          toolType: this.classifyToolType(toolName),
          timestamp,
          returnTokens,
        });

        // Update aggregate stats
        if (!toolUsage.has(toolName)) {
          toolUsage.set(toolName, {
            toolName,
            callCount: 0,
            totalReturnTokens: 0,
            returnTokenCounts: []
          });
        }
        const detail = toolUsage.get(toolName)!;
        detail.totalReturnTokens += returnTokens;
        detail.returnTokenCounts.push(returnTokens);
      }
    } catch (error) {
      logger.error({ logId: log.id, error }, 'Failed to extract completed tool calls');
      throw error;
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
      tools: toolDetails,
      toolCalls: toolCallDetails
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
   * Extract tool_use blocks from response content WITH IDs.
   */
  private extractToolCallsWithIds(log: InteractionLog): Array<{ toolCallId: string; toolName: string }> {
    const toolCalls: Array<{ toolCallId: string; toolName: string }> = [];

    try {
      const body = log.response?.body as any;
      if (body && Array.isArray(body.content)) {
        for (const block of body.content) {
          if (block && block.type === 'tool_use' && typeof block.name === 'string' && typeof block.id === 'string') {
            toolCalls.push({
              toolCallId: block.id,
              toolName: block.name
            });
          }
        }
      }
    } catch (error) {
      // Ignore parsing errors
    }

    return toolCalls;
  }

  /**
   * Extract COMPLETED tool calls from request messages.
   * Finds tool_use blocks (from previous assistant turn) paired with their tool_result blocks.
   * Returns complete records with toolCallId, toolName, timestamp, and returnTokens.
   */
  private async extractCompletedToolCallsFromRequest(
    log: InteractionLog,
    model: string
  ): Promise<Array<{ toolCallId: string; toolName: string; timestamp: string; returnTokens: number }>> {
    const completedCalls: Array<{ toolCallId: string; toolName: string; timestamp: string; returnTokens: number }> = [];

    try {
      const body = log.request.body as any;
      if (!body || !Array.isArray(body.messages)) {
        return completedCalls;
      }

      // First, extract all tool_use blocks from the request (from previous assistant turn)
      const toolUseMap = new Map<string, { toolName: string; timestamp: string }>();

      for (const message of body.messages) {
        if (message && Array.isArray(message.content)) {
          for (const block of message.content) {
            if (block && block.type === 'tool_use' && block.id && block.name) {
              // Use this log's timestamp as approximation (the actual call was made in a previous log)
              // but we use the tool_use presence here to know when the call was conceptually made
              toolUseMap.set(block.id, {
                toolName: block.name,
                timestamp: log.timestamp // This is close enough - the call was made just before this log
              });
            }
          }
        }
      }

      // Now extract tool_result blocks and match them with tool_use
      const toolResults: Array<{ toolCallId: string; content: string }> = [];

      for (const message of body.messages) {
        if (message && Array.isArray(message.content)) {
          for (const block of message.content) {
            if (block && block.type === 'tool_result' && block.tool_use_id) {
              const content = this.extractToolResultContent(block);
              toolResults.push({
                toolCallId: block.tool_use_id,
                content
              });
            }
          }
        }
      }

      // Count tokens for all tool results in parallel
      const tokenCounts = await Promise.all(
        toolResults.map(async ({ toolCallId, content }) => {
          const tokenCount = await countContentTokens(model, content);
          return { toolCallId, tokenCount };
        })
      );

      // Match tool_use with tool_result
      for (const { toolCallId, tokenCount } of tokenCounts) {
        const toolUse = toolUseMap.get(toolCallId);
        if (toolUse) {
          completedCalls.push({
            toolCallId,
            toolName: toolUse.toolName,
            timestamp: toolUse.timestamp,
            returnTokens: tokenCount
          });
        }
      }
    } catch (error) {
      logger.error({ logId: log.id, error }, 'Error extracting completed tool calls');
      throw error;
    }

    return completedCalls;
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
