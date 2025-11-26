// Wrapper for @anthropic-ai/tokenizer to handle ESM/CJS compatibility issues in Vite
// The tokenizer package is CommonJS but Vite expects ES modules in development

let countTokensFunc: any = null;

// Lazy load the tokenizer to avoid import issues
async function loadTokenizer() {
  if (!countTokensFunc) {
    try {
      // Try dynamic import first (works in production build)
      const module = await import('@anthropic-ai/tokenizer');
      countTokensFunc = module.countTokens || module.default?.countTokens;
    } catch (e) {
      // Fallback for development - this should not happen but just in case
      console.warn('Failed to load tokenizer, using fallback estimation', e);
      // Simple fallback estimation (very rough)
      countTokensFunc = (text: string) => {
        // Rough estimation: ~4 characters per token on average
        return Math.ceil(text.length / 4);
      };
    }
  }
  return countTokensFunc;
}

// Export a wrapper that handles the async loading
export async function countTokens(text: string, model?: string): Promise<number> {
  const fn = await loadTokenizer();
  return fn(text, model);
}

// Also provide a synchronous fallback for initial render
export function countTokensSync(text: string): number {
  // Simple estimation for immediate use (before async load)
  return Math.ceil(text.length / 4);
}