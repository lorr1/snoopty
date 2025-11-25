/**
 * Agent Tag Analyzer
 *
 * Detects and tags agents based on system prompts.
 * This integrates agentTagger.ts functionality into the analyzer framework.
 */

import { logger } from '../logger';
import type { InteractionLog, AgentTagInfo, AgentTagId, AgentTagTheme } from '../../shared/types';
import type { MetricsAnalyzer } from './MetricsAnalyzer';

type AgentTagMatcher = RegExp | ((value: string) => boolean);

interface AgentTagRule {
  id: AgentTagId;
  label: string;
  description?: string;
  theme: AgentTagTheme;
  matchers: AgentTagMatcher[];
}

const TAG_RULES: AgentTagRule[] = [
  {
    id: 'topic-labeler',
    label: 'Topic Labeler',
    description: 'Detects whether a message starts a new conversation and extracts a title.',
    theme: {
      text: '#7e22ce',
      background: 'rgba(147, 51, 234, 0.12)',
      border: 'rgba(147, 51, 234, 0.3)',
    },
    matchers: [/new conversation topic/i, /extract a 2-3 word title/i],
  },
  {
    id: 'conversation-summarizer',
    label: 'Conversation Summarizer',
    description: 'Writes short titles or summaries for full transcripts.',
    theme: {
      text: '#4c1d95',
      background: 'rgba(99, 102, 241, 0.12)',
      border: 'rgba(99, 102, 241, 0.3)',
    },
    matchers: [/summarize this coding conversation/i, /write a .*word title/i],
  },
  {
    id: 'file-search',
    label: 'File Search Specialist',
    description: 'Handles glob/grep/file-read requests for the primary agent.',
    theme: {
      text: '#b45309',
      background: 'rgba(249, 115, 22, 0.16)',
      border: 'rgba(249, 115, 22, 0.35)',
    },
    matchers: [/file search specialist/i],
  },
  {
    id: 'framework-detector',
    label: 'Framework Detector',
    description: 'Identifies languages plus frameworks/libraries from snippets.',
    theme: {
      text: '#047857',
      background: 'rgba(16, 185, 129, 0.15)',
      border: 'rgba(16, 185, 129, 0.35)',
    },
    matchers: [/framework and library detection assistant/i],
  },
  {
    id: 'language-detector',
    label: 'Language Detector',
    description: 'Determines conversation language or VS Code diagnostics.',
    theme: {
      text: '#0369a1',
      background: 'rgba(14, 165, 233, 0.15)',
      border: 'rgba(14, 165, 233, 0.35)',
    },
    matchers: [/language diagnostics/i, /language detection/i, /language_name/i],
  },
  {
    id: 'primary',
    label: 'Primary Agent',
    description: 'Main CLI agent coordinating user requests.',
    theme: {
      text: '#1d4ed8',
      background: 'rgba(59, 130, 246, 0.14)',
      border: 'rgba(37, 99, 235, 0.35)',
    },
    matchers: [/anthropic's official cli/i, /interactive cli tool/i, /claude code/i],
  },
  {
    id: 'unknown',
    label: 'Untagged',
    description: 'No system prompt present to identify the agent.',
    theme: {
      text: '#0f172a',
      background: 'rgba(15, 23, 42, 0.08)',
      border: 'rgba(15, 23, 42, 0.2)',
    },
    matchers: [() => true],
  },
];

export class AgentTagAnalyzer implements MetricsAnalyzer<AgentTagInfo> {
  name = 'agent-tag';

  async analyze(log: InteractionLog): Promise<AgentTagInfo | null> {
    logger.info(
      { logId: log.id, path: log.path },
      'AgentTagAnalyzer: Starting analysis'
    );

    try {
      const body = log.request.body;
      return this.deriveAgentTag(body);
    } catch (error) {
      logger.error({ logId: log.id, error }, 'AgentTagAnalyzer: Failed to derive agent tag');
      return null;
    }
  }

  private deriveAgentTag(body: unknown): AgentTagInfo {
    const systemText = this.collectSystemPrompt(body);
    const normalized = systemText.toLowerCase();

    for (const rule of TAG_RULES) {
      if (
        rule.matchers.some((matcher) =>
          matcher instanceof RegExp ? matcher.test(normalized) : matcher(normalized)
        )
      ) {
        return this.ruleToInfo(rule);
      }
    }

    return this.ruleToInfo(TAG_RULES[TAG_RULES.length - 1]!);
  }

  private collectSystemPrompt(body: unknown): string {
    const record = this.coerceRecord(body);
    if (!record) {
      return typeof body === 'string' ? body : '';
    }

    const segments: string[] = [];
    if (record.system !== undefined) {
      segments.push(...this.extractTextChunks(record.system));
    }

    if (Array.isArray(record.messages)) {
      record.messages.forEach((message) => {
        if (!this.isPlainRecord(message)) {
          return;
        }
        if (typeof message.role === 'string' && message.role.toLowerCase() === 'system') {
          segments.push(...this.extractTextChunks(message.content));
        }
      });
    }

    return segments
      .map((segment) => segment?.trim())
      .filter((segment): segment is string => Boolean(segment && segment.length > 0))
      .join('\n');
  }

  private extractTextChunks(value: unknown, depth = 0): string[] {
    if (depth > 3 || value === null || value === undefined) {
      return [];
    }
    if (typeof value === 'string') {
      return [value];
    }
    if (Array.isArray(value)) {
      return value.flatMap((entry) => this.extractTextChunks(entry, depth + 1));
    }
    if (this.isPlainRecord(value)) {
      const chunks: string[] = [];
      if (typeof value.text === 'string') {
        chunks.push(value.text);
      }
      if (Object.prototype.hasOwnProperty.call(value, 'content')) {
        chunks.push(...this.extractTextChunks(value.content, depth + 1));
      }
      return chunks;
    }
    return [];
  }

  private isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private coerceRecord(value: unknown): Record<string, unknown> | null {
    if (this.isPlainRecord(value)) {
      return value;
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (this.isPlainRecord(parsed)) {
          return parsed;
        }
      } catch {
        return null;
      }
    }
    return null;
  }

  private ruleToInfo(rule: AgentTagRule): AgentTagInfo {
    const info: AgentTagInfo = {
      id: rule.id,
      label: rule.label,
      theme: rule.theme,
    };
    if (rule.description) {
      info.description = rule.description;
    }
    return info;
  }
}
