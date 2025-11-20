export function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

export function formatRangeLabel(ms: number): string {
  if (ms <= 0) {
    return '—';
  }
  const date = new Date(ms);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}
