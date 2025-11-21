/**
 * Formatting utility functions for the Snoopty UI.
 */

export function formatTimestamp(value: string): string {
  try {
    const date = new Date(value);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  } catch {
    return value;
  }
}

export function formatTimeOfDay(value: string): string {
  try {
    const date = new Date(value);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return value;
  }
}

export function formatDuration(durationMs?: number): string {
  const MILLIS_PER_SECOND = 1000;
  if (typeof durationMs !== 'number' || Number.isNaN(durationMs)) {
    return '—';
  }
  if (durationMs < MILLIS_PER_SECOND) {
    return `${durationMs.toFixed(0)} ms`;
  }
  return `${(durationMs / MILLIS_PER_SECOND).toFixed(2)} s`;
}

export function prettifyJson(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function formatBody(value: unknown, emptyLabel: string): string {
  const formatted = prettifyJson(value);
  return formatted === '' ? emptyLabel : formatted;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function formatRoleLabel(role: string): string {
  if (!role) {
    return 'Message';
  }
  const normalized = role.replace(/_/g, ' ').trim();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function formatRichContent(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => formatRichContent(entry))
      .filter((chunk) => chunk.trim().length > 0)
      .join('\n\n');
  }
  if (isPlainRecord(value) && typeof value.text === 'string') {
    return value.text;
  }
  return prettifyJson(value);
}

export function formatToolPayload(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return prettifyJson(value);
}

export function formatToolDefinition(value: unknown): string {
  if (!isPlainRecord(value)) {
    return formatToolPayload(value);
  }

  const summarySections: string[] = [];
  const type =
    typeof value.type === 'string' && value.type.trim().length > 0 ? value.type.trim() : null;
  const description =
    typeof value.description === 'string' && value.description.trim().length > 0
      ? value.description.trim()
      : null;
  const inputSchema = Object.prototype.hasOwnProperty.call(value, 'input_schema')
    ? (value as { input_schema?: unknown }).input_schema
    : undefined;

  const metaLines: string[] = [];
  if (type) {
    metaLines.push(`Type: ${type}`);
  }
  if (metaLines.length > 0) {
    summarySections.push(metaLines.join('\n'));
  }

  if (description) {
    summarySections.push(`\n${description}`);
  }

  if (inputSchema !== undefined) {
    summarySections.push(`Input schema:\n${prettifyJson(inputSchema)}`);
  }

  const extraEntries = Object.entries(value).filter(
    ([key, entryValue]) =>
      entryValue !== undefined &&
      key !== 'name' &&
      key !== 'type' &&
      key !== 'description' &&
      key !== 'input_schema',
  );
  if (extraEntries.length > 0) {
    summarySections.push(`Other fields:\n${prettifyJson(Object.fromEntries(extraEntries))}`);
  }

  if (summarySections.length > 0) {
    return summarySections.join('\n\n');
  }
  return formatToolPayload(value);
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatRelativeDate(value: Date): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (isSameDay(value, today)) {
    return 'Today';
  }
  if (isSameDay(value, yesterday)) {
    return 'Yesterday';
  }

  return value.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}
