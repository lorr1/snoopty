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
  tool_return_mcp: string[];
  tool_return_regular: string[];
  tool_use_mcp: string[];
  tool_use_regular: string[];
}

interface OutputBuckets {
  assistant: string[];
  thinking: string[];
  tool_use_mcp: string[];
  tool_use_regular: string[];
}

const EMPTY_INPUT_BUCKETS = (): InputBuckets => ({
  system: [],
  user: [],
  assistant: [],
  thinking: [],
  tool_return_mcp: [],
  tool_return_regular: [],
  tool_use_mcp: [],
  tool_use_regular: [],
});

const EMPTY_OUTPUT_BUCKETS = (): OutputBuckets => ({
  assistant: [],
  thinking: [],
  tool_use_mcp: [],
  tool_use_regular: [],
});

export class TokenBreakdownAnalyzer implements MetricsAnalyzer<TokenUsageSummary> {
  name = 'token-breakdown';

  /**
   * Classify tool as MCP or regular based on naming convention.
   * MCP tools start with 'mcp__'.
   */
  private classifyToolType(toolName: string): 'mcp' | 'regular' {
    return toolName.startsWith('mcp__') ? 'mcp' : 'regular';
  }

  /**
   * Separate tools array into MCP and Regular arrays
   */
  private separateToolsByType(tools: unknown[]): { mcpTools: unknown[]; regularTools: unknown[] } {
    const mcpTools: unknown[] = [];
    const regularTools: unknown[] = [];

    for (const tool of tools) {
      if (tool && typeof tool === 'object' && 'name' in tool && typeof tool.name === 'string') {
        if (this.classifyToolType(tool.name) === 'mcp') {
          mcpTools.push(tool);
        } else {
          regularTools.push(tool);
        }
      }
    }

    return { mcpTools, regularTools };
  }

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

    // Separate tools by type
    let mcpTools: unknown[] = [];
    let regularTools: unknown[] = [];
    if (tools && Array.isArray(tools) && tools.length > 0) {
      const separated = this.separateToolsByType(tools);
      mcpTools = separated.mcpTools;
      regularTools = separated.regularTools;
    }

    // Run all token counting API calls in parallel
    const [
      inputSystemDetail,
      inputUserDetail,
      inputAssistantDetail,
      inputThinkingDetail,
      inputToolMcpDetail,
      inputToolRegularDetail,
      inputToolReturnMcpDetail,
      inputToolReturnRegularDetail,
      inputToolUseMcpDetail,
      inputToolUseRegularDetail,
      outputAssistantDetail,
      outputThinkingDetail,
      outputToolUseMcpDetail,
      outputToolUseRegularDetail,
    ] = await Promise.all([
      this.buildDetail('system', inputBuckets.system, model),
      this.buildDetail('user', inputBuckets.user, model),
      this.buildDetail('assistant', inputBuckets.assistant, model),
      this.buildDetail('thinking', inputBuckets.thinking, model),
      this.buildDetail('tool_mcp', [], model, mcpTools),
      this.buildDetail('tool_regular', [], model, regularTools),
      this.buildDetail('tool_return_mcp', inputBuckets.tool_return_mcp, model),
      this.buildDetail('tool_return_regular', inputBuckets.tool_return_regular, model),
      this.buildDetail('tool_use_mcp', inputBuckets.tool_use_mcp, model),
      this.buildDetail('tool_use_regular', inputBuckets.tool_use_regular, model),
      this.buildDetail('assistant', outputBuckets.assistant, model),
      this.buildDetail('thinking', outputBuckets.thinking, model),
      this.buildDetail('tool_use_mcp', outputBuckets.tool_use_mcp, model),
      this.buildDetail('tool_use_regular', outputBuckets.tool_use_regular, model),
    ]);

    const systemUsage = entry.tokenUsage.system_totals;

    const inputSegments: Record<string, TokenCountDetail> = {
      system: inputSystemDetail,
      user: inputUserDetail,
      assistant: inputAssistantDetail,
      thinking: inputThinkingDetail,
      tool_mcp: inputToolMcpDetail,
      tool_regular: inputToolRegularDetail,
      tool_return_mcp: inputToolReturnMcpDetail,
      tool_return_regular: inputToolReturnRegularDetail,
      tool_use_mcp: inputToolUseMcpDetail,
      tool_use_regular: inputToolUseRegularDetail,
    };

    const outputSegments: Record<string, TokenCountDetail> = {
      assistant: outputAssistantDetail,
      thinking: outputThinkingDetail,
      tool_use_mcp: outputToolUseMcpDetail,
      tool_use_regular: outputToolUseRegularDetail,
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
    // For tool definitions, check tools array instead of textSegments
    const isToolDefinition = role === 'tool_mcp' || role === 'tool_regular';

    if (!isToolDefinition && textSegments.length === 0) {
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
        case 'tool_return_mcp':
        case 'tool_return_regular':
          tokens = await countUserTokens(model, combined);
          textLength = combined.length;
          segments = textSegments.length;
          break;
        case 'assistant':
        case 'thinking':
        case 'tool_use_mcp':
        case 'tool_use_regular':
          tokens = await countAssistantTokens(model, combined);
          textLength = combined.length;
          segments = textSegments.length;
          break;
        case 'tool_mcp':
        case 'tool_regular':
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
    tool_use_mcp: string[];
    tool_use_regular: string[];
    tool_result_unclassified: string[]; // Wrapped with toolUseId, classified later
  } {
    const result = {
      text: [],
      thinking: [],
      tool_use_mcp: [],
      tool_use_regular: [],
      tool_result_unclassified: [],
    } as {
      text: string[];
      thinking: string[];
      tool_use_mcp: string[];
      tool_use_regular: string[];
      tool_result_unclassified: string[];
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
            const toolName = typeof value.name === 'string' ? value.name : '';
            const toolType = this.classifyToolType(toolName);
            const value_with_relevant_fields = {
              name: value.name,
              input: value.input,
            };
            const serialized = JSON.stringify(value_with_relevant_fields);
            if (toolType === 'mcp') {
              result.tool_use_mcp.push(serialized);
            } else {
              result.tool_use_regular.push(serialized);
            }
          } else if (value.type === 'tool_result') {
            if ('content' in value) {
              const contentStr = typeof value.content === 'string'
                ? value.content
                : JSON.stringify(value.content);
              const toolUseId = value.tool_use_id;
              // Store with toolUseId for classification in collectRequestBuckets
              result.tool_result_unclassified.push(JSON.stringify({ toolUseId, content: contentStr }));
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
        const toolName = typeof value.name === 'string' ? value.name : '';
        const toolType = this.classifyToolType(toolName);
        if (toolType === 'mcp') {
          result.tool_use_mcp.push(JSON.stringify(value));
        } else {
          result.tool_use_regular.push(JSON.stringify(value));
        }
      } else if (value.type === 'tool_result') {
        if ('content' in value) {
          const contentStr = typeof value.content === 'string'
            ? value.content
            : JSON.stringify(value.content);
          const toolUseId = value.tool_use_id;
          // Store with toolUseId for classification in collectRequestBuckets
          result.tool_result_unclassified.push(JSON.stringify({ toolUseId, content: contentStr }));
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

    // Build tool_use_id to tool name mapping for classifying tool_result blocks
    const toolUseIdToName = new Map<string, string>();

    const messages = data.messages;
    if (Array.isArray(messages)) {
      // First pass: collect tool_use blocks to build the mapping
      for (const raw of messages) {
        if (!raw || typeof raw !== 'object') {
          continue;
        }
        const message = raw as { role?: string; content?: unknown };
        if (message.role === 'assistant' && Array.isArray(message.content)) {
          for (const block of message.content) {
            if (block && typeof block === 'object' && 'type' in block) {
              const b = block as Record<string, unknown>;
              if (b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') {
                toolUseIdToName.set(b.id, b.name);
              }
            }
          }
        }
      }

      // Second pass: collect content into buckets
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
            // Classify tool_result by looking up tool name
            for (const segment of contentByType.tool_result_unclassified) {
              try {
                const parsed = JSON.parse(segment) as { toolUseId?: string; content: string };
                if (parsed.toolUseId) {
                  const toolName = toolUseIdToName.get(parsed.toolUseId);
                  if (toolName) {
                    const toolType = this.classifyToolType(toolName);
                    if (toolType === 'mcp') {
                      this.addIfPresent(buckets.tool_return_mcp, parsed.content);
                    } else {
                      this.addIfPresent(buckets.tool_return_regular, parsed.content);
                    }
                  } else {
                    // Unknown tool, default to regular
                    this.addIfPresent(buckets.tool_return_regular, parsed.content);
                  }
                } else {
                  this.addIfPresent(buckets.tool_return_regular, parsed.content);
                }
              } catch {
                // If parse fails, treat as regular
                this.addIfPresent(buckets.tool_return_regular, segment);
              }
            }
            break;
          case 'assistant':
            for (const segment of contentByType.text) {
              this.addIfPresent(buckets.assistant, segment);
            }
            for (const segment of contentByType.thinking) {
              this.addIfPresent(buckets.thinking, segment);
            }
            for (const segment of contentByType.tool_use_mcp) {
              this.addIfPresent(buckets.tool_use_mcp, segment);
            }
            for (const segment of contentByType.tool_use_regular) {
              this.addIfPresent(buckets.tool_use_regular, segment);
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
        for (const segment of contentByType.tool_use_mcp) {
          this.addIfPresent(buckets.tool_use_mcp, segment);
        }
        for (const segment of contentByType.tool_use_regular) {
          this.addIfPresent(buckets.tool_use_regular, segment);
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
              if (contentBlock?.type === 'tool_use' && typeof contentBlock.name === 'string') {
                const toolType = this.classifyToolType(contentBlock.name);
                const serialized = JSON.stringify(contentBlock);
                if (toolType === 'mcp') {
                  this.addIfPresent(buckets.tool_use_mcp, serialized);
                } else {
                  this.addIfPresent(buckets.tool_use_regular, serialized);
                }
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
