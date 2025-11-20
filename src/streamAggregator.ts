import { logger } from './logger';

type SseEvent = {
  event?: string;
  data: string;
};

type AnthropicMessage = {
  id?: string;
  type?: string;
  role?: string;
  model?: string;
  stop_reason?: string | null;
  stop_sequence?: string | null;
  usage?: Record<string, unknown>;
  content: Array<Record<string, unknown>>;
};

type TextContent = { type: 'text'; text: string };
type ToolUseContent = { type: 'tool_use'; id: string; name: string; input: unknown };
type ThinkingContent = { type: 'thinking'; thinking: string; signature?: string };

type BlockBuilder =
  | { kind: 'text'; node: TextContent }
  | { kind: 'tool_use'; node: ToolUseContent; buffer: string }
  | { kind: 'thinking'; node: ThinkingContent }
  | { kind: 'passthrough'; node: Record<string, unknown> };

class SseParser {
  private buffer = '';

  constructor(private onEvent: (event: SseEvent) => void) {}

  feed(chunk: string): void {
    if (!chunk) {
      return;
    }
    this.buffer += chunk;
    this.flush(false);
  }

  finalize(): void {
    this.flush(true);
  }

  private flush(force: boolean): void {
    let delimiterIndex = this.buffer.indexOf('\n\n');
    while (delimiterIndex !== -1) {
      const block = this.buffer.slice(0, delimiterIndex);
      this.buffer = this.buffer.slice(delimiterIndex + 2);
      this.emitBlock(block);
      delimiterIndex = this.buffer.indexOf('\n\n');
    }

    if (force && this.buffer.trim().length > 0) {
      const remaining = this.buffer;
      this.buffer = '';
      this.emitBlock(remaining);
    }
  }

  private emitBlock(raw: string): void {
    if (!raw) {
      return;
    }
    const lines = raw.split('\n');
    let eventName: string | undefined;
    const dataLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.replace(/\r$/, '');
      if (trimmed.startsWith('event:')) {
        eventName = trimmed.slice(6).trim();
        continue;
      }
      if (trimmed.startsWith('data:')) {
        const value = trimmed.slice(5);
        dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
      }
    }

    const data = dataLines.join('\n');
    if (!data) {
      return;
    }
    const payload = eventName ? { event: eventName, data } : { data };
    this.onEvent(payload as SseEvent);
  }
}

export class AnthropicStreamAggregator {
  private parser = new SseParser((event) => this.handleEvent(event));
  private message: AnthropicMessage | null = null;
  private builders = new Map<number, BlockBuilder>();
  private errors: string[] = [];

  ingest(chunk: string): void {
    this.parser.feed(chunk);
  }

  finalize(): AnthropicMessage | null {
    this.parser.finalize();
    if (this.builders.size > 0) {
      this.builders.clear();
    }
    if (this.errors.length > 0) {
      logger.warn({ errors: this.errors }, 'stream aggregation completed with warnings');
    }
    return this.message;
  }

  private handleEvent(event: SseEvent): void {
    if (!event.data) {
      return;
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(event.data) as Record<string, unknown>;
    } catch (error) {
      this.errors.push(`failed to parse SSE data: ${(error as Error).message}`);
      return;
    }

    const type = (payload.type as string | undefined) ?? event.event;
    switch (type) {
      case 'message_start':
        this.handleMessageStart(payload);
        break;
      case 'content_block_start':
        this.handleContentBlockStart(payload);
        break;
      case 'content_block_delta':
        this.handleContentBlockDelta(payload);
        break;
      case 'content_block_stop':
        this.handleContentBlockStop(payload);
        break;
      case 'message_delta':
        this.handleMessageDelta(payload);
        break;
      case 'message_stop':
        // nothing to merge; we finalize when parser completes
        break;
      default:
        // ignore pings and other out-of-band events
        break;
    }
  }

  private ensureMessage(): AnthropicMessage {
    if (!this.message) {
      this.message = {
        content: [],
      };
      return this.message;
    }
    if (!Array.isArray(this.message.content)) {
      this.message.content = [];
    }
    return this.message;
  }

  private handleMessageStart(payload: Record<string, unknown>): void {
    const message = this.ensureMessage();
    const rawMessage = payload.message as Record<string, unknown> | undefined;
    if (rawMessage) {
      Object.assign(message, rawMessage);
    }
    message.content = [];
  }

  private handleContentBlockStart(payload: Record<string, unknown>): void {
    const index = typeof payload.index === 'number' ? payload.index : 0;
    const contentBlock = payload.content_block as Record<string, unknown> | undefined;
    const message = this.ensureMessage();

    if (!contentBlock) {
      return;
    }

    const blockType = contentBlock.type as string | undefined;

    if (blockType === 'text') {
      const node: TextContent = {
        type: 'text',
        text: typeof contentBlock.text === 'string' ? contentBlock.text : '',
      };
      message.content.push(node);
      this.builders.set(index, { kind: 'text', node });
      return;
    }

    if (blockType === 'tool_use') {
      const node: ToolUseContent = {
        type: 'tool_use',
        id: typeof contentBlock.id === 'string' ? contentBlock.id : `tool_${index}`,
        name: typeof contentBlock.name === 'string' ? contentBlock.name : 'tool',
        input: contentBlock.input ?? null,
      };
      message.content.push(node);
      this.builders.set(index, { kind: 'tool_use', node, buffer: '' });
      return;
    }

    if (blockType === 'thinking') {
      const node: ThinkingContent = {
        type: 'thinking',
        thinking: typeof contentBlock.thinking === 'string' ? contentBlock.thinking : '',
      };
      if (typeof contentBlock.signature === 'string') {
        node.signature = contentBlock.signature;
      }
      message.content.push(node);
      this.builders.set(index, { kind: 'thinking', node });
      return;
    }

    const node = { ...contentBlock };
    message.content.push(node);
    this.builders.set(index, { kind: 'passthrough', node });
  }

  private handleContentBlockDelta(payload: Record<string, unknown>): void {
    const index = typeof payload.index === 'number' ? payload.index : 0;
    const delta = payload.delta as Record<string, unknown> | undefined;
    const builder = this.builders.get(index);
    if (!builder || !delta) {
      return;
    }

    if (builder.kind === 'text' && typeof delta.text === 'string') {
      builder.node.text += delta.text;
      return;
    }

    if (builder.kind === 'tool_use' && typeof delta.partial_json === 'string') {
      builder.buffer += delta.partial_json;
      return;
    }

    if (builder.kind === 'thinking') {
      if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        builder.node.thinking += delta.thinking;
      }
      if (delta.type === 'signature_delta' && typeof delta.signature === 'string') {
        builder.node.signature = delta.signature;
      }
      return;
    }
  }

  private handleContentBlockStop(payload: Record<string, unknown>): void {
    const index = typeof payload.index === 'number' ? payload.index : 0;
    const builder = this.builders.get(index);
    if (!builder) {
      return;
    }

    if (builder.kind === 'tool_use') {
      if (builder.buffer.length > 0) {
        try {
          builder.node.input = JSON.parse(builder.buffer);
        } catch (error) {
          builder.node.input = builder.buffer;
          this.errors.push(`failed to parse tool input JSON: ${(error as Error).message}`);
        }
      }
    }

    this.builders.delete(index);
  }

  private handleMessageDelta(payload: Record<string, unknown>): void {
    const message = this.ensureMessage();
    const delta = payload.delta as Record<string, unknown> | undefined;
    if (delta) {
      if ('stop_reason' in delta) {
        message.stop_reason = delta.stop_reason as string | null;
      }
      if ('stop_sequence' in delta) {
        message.stop_sequence = delta.stop_sequence as string | null;
      }
      if ('role' in delta && !message.role) {
        message.role = delta.role as string;
      }
    }

    if (payload.usage && typeof payload.usage === 'object') {
      message.usage = {
        ...(message.usage ?? {}),
        ...(payload.usage as Record<string, unknown>),
      };
    }
  }
}
