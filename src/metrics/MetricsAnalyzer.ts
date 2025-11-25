/**
 * Metrics Analyzer Framework
 *
 * Provides a pluggable system for computing metrics on InteractionLog objects.
 * Each analyzer extracts and computes specific metrics (e.g., tool usage, token counts).
 *
 * Design: Compute once for ALL logs, query/filter at aggregation time.
 */

import type { InteractionLog } from '../../shared/types';

/**
 * Base interface for all metrics analyzers.
 *
 * Each analyzer should:
 * - Extract relevant data from the log
 * - Compute metrics independently
 * - Return null if the log doesn't apply to this analyzer
 */
export interface MetricsAnalyzer<T = unknown> {
  /** Unique identifier for this analyzer */
  name: string;

  /**
   * Analyze a single interaction log and return computed metrics.
   *
   * @param log - The interaction log to analyze
   * @returns Computed metrics or null if not applicable
   */
  analyze(log: InteractionLog): Promise<T | null>;
}

/**
 * Registry for managing all metrics analyzers.
 *
 * Provides centralized registration and execution of all analyzers.
 */
export class MetricsRegistry {
  private analyzers: Map<string, MetricsAnalyzer> = new Map();

  /**
   * Register a metrics analyzer.
   */
  register(analyzer: MetricsAnalyzer): void {
    if (this.analyzers.has(analyzer.name)) {
      throw new Error(`Analyzer '${analyzer.name}' is already registered`);
    }
    this.analyzers.set(analyzer.name, analyzer);
  }

  /**
   * Unregister an analyzer by name.
   */
  unregister(name: string): boolean {
    return this.analyzers.delete(name);
  }

  /**
   * Get a specific analyzer by name.
   */
  get(name: string): MetricsAnalyzer | undefined {
    return this.analyzers.get(name);
  }

  /**
   * Get all registered analyzer names.
   */
  getAnalyzerNames(): string[] {
    return Array.from(this.analyzers.keys());
  }

  /**
   * Check if a metric already exists on the log entry.
   * Centralized logic to determine if an analyzer should run.
   *
   * @param log - The interaction log
   * @param analyzerName - The name of the analyzer
   * @returns true if the metric already exists, false otherwise
   */
  private metricExists(log: InteractionLog, analyzerName: string): boolean {
    switch (analyzerName) {
      case 'tool-metrics':
        return !!log.toolMetrics;
      case 'token-breakdown':
        return !!log.tokenUsage.custom;
      case 'agent-tag':
        return !!log.agentTag;
      default:
        // Unknown analyzer - always run
        return false;
    }
  }

  /**
   * Run all registered analyzers on a log.
   *
   * Returns a map of analyzer name to computed metrics.
   * Failed analyzers return error objects instead of null.
   * Skips analyzers whose metrics already exist (unless force=true).
   *
   * @param log - The interaction log to analyze
   * @param force - If true, run analyzers even if metrics already exist
   * @returns Map of analyzer name to metrics result
   */
  async analyzeAll(log: InteractionLog, force = false): Promise<Map<string, unknown>> {
    const results = new Map<string, unknown>();

    // Run all analyzers in parallel, but skip those that already have data (unless force)
    const analyzerEntries = Array.from(this.analyzers.entries());
    const promises = analyzerEntries.map(async ([name, analyzer]) => {
      // Check if metric already exists
      const exists = this.metricExists(log, name);

      if (exists && !force) {
        return {
          name,
          result: null,
          error: null,
          skipped: true,
          reason: 'Metric already exists'
        };
      }

      try {
        const result = await analyzer.analyze(log);
        return { name, result, error: null, skipped: false };
      } catch (error) {
        return {
          name,
          result: null,
          error: error instanceof Error ? error.message : String(error),
          skipped: false
        };
      }
    });

    const settled = await Promise.all(promises);

    // Collect results
    for (const { name, result, error, skipped } of settled) {
      if (skipped) {
        // Don't add skipped analyzers to results
        continue;
      }

      if (error) {
        results.set(name, { error });
      } else if (result !== null) {
        results.set(name, result);
      }
    }

    return results;
  }

  /**
   * Run a specific analyzer on a log.
   */
  async analyzeSingle(analyzerName: string, log: InteractionLog): Promise<unknown> {
    const analyzer = this.analyzers.get(analyzerName);
    if (!analyzer) {
      throw new Error(`Analyzer '${analyzerName}' not found`);
    }
    return analyzer.analyze(log);
  }
}

/**
 * Global singleton registry instance.
 *
 * Analyzers should register themselves on module import:
 * ```typescript
 * globalMetricsRegistry.register(new MyAnalyzer());
 * ```
 */
export const globalMetricsRegistry = new MetricsRegistry();
