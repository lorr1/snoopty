/**
 * Metrics Worker
 *
 * Background worker that processes ALL logs and computes metrics.
 * Runs independently of the proxy handler to avoid blocking responses.
 *
 * Design:
 * - Watches log directory for new/updated files
 * - Runs all registered analyzers on each log
 * - Updates log files with computed metrics
 * - Graceful error handling per analyzer
 */

import { watch } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import type { InteractionLog } from '../../shared/types';
import { appConfig } from '../config';
import { logger } from '../logger';
import { globalMetricsRegistry } from '../metrics/MetricsAnalyzer';

interface MetricsWorkerOptions {
  /** Polling interval in milliseconds for checking unprocessed logs */
  pollInterval?: number;
  /** Whether to process existing logs on startup */
  processExisting?: boolean;
  /** Whether to watch for new log files */
  watchForNew?: boolean;
}

export class MetricsWorker {
  private logDir: string;
  private pollInterval: number;
  private watchForNew: boolean;
  private processExisting: boolean;
  private isRunning: boolean = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private watcher: ReturnType<typeof watch> | null = null;
  private processingQueue: Set<string> = new Set();

  constructor(options: MetricsWorkerOptions = {}) {
    this.logDir = appConfig.logDir;
    this.pollInterval = options.pollInterval ?? 5000; // 5 seconds default
    this.processExisting = options.processExisting ?? true;
    this.watchForNew = options.watchForNew ?? true;

    logger.info(
      {
        logDir: this.logDir,
        pollInterval: this.pollInterval,
        processExisting: this.processExisting,
        watchForNew: this.watchForNew,
      },
      'MetricsWorker: Initialized with options'
    );
  }

  /**
   * Start the metrics worker.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('MetricsWorker: Already running, ignoring start request');
      return;
    }

    this.isRunning = true;
    logger.info({ logDir: this.logDir }, 'MetricsWorker: Starting worker');

    // Log registered analyzers
    const analyzers = globalMetricsRegistry.getAnalyzerNames();
    logger.info({ analyzers }, 'MetricsWorker: Registered analyzers');

    // Process existing logs on startup
    if (this.processExisting) {
      logger.info('MetricsWorker: Processing existing logs');
      await this.processExistingLogs();
    } else {
      logger.info('MetricsWorker: Skipping existing logs (processExisting=false)');
    }

    // Start watching for new logs
    if (this.watchForNew) {
      logger.info('MetricsWorker: Starting file watcher');
      this.startWatching();
    } else {
      logger.info('MetricsWorker: Not watching for new files (watchForNew=false)');
    }

    // Start polling for unprocessed logs
    logger.info({ pollInterval: this.pollInterval }, 'MetricsWorker: Starting polling');
    this.startPolling();

    logger.info('MetricsWorker: Started successfully');
  }

  /**
   * Stop the metrics worker.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('MetricsWorker: Not running, ignoring stop request');
      return;
    }

    logger.info('MetricsWorker: Stopping worker');
    this.isRunning = false;

    if (this.pollTimer) {
      logger.debug('MetricsWorker: Clearing poll timer');
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.watcher) {
      logger.debug('MetricsWorker: Closing file watcher');
      this.watcher.close();
      this.watcher = null;
    }

    // Wait for any in-progress processing to complete
    if (this.processingQueue.size > 0) {
      logger.info(
        { queueSize: this.processingQueue.size },
        'MetricsWorker: Waiting for in-progress processing to complete'
      );
      while (this.processingQueue.size > 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    logger.info('MetricsWorker: Stopped successfully');
  }

  /**
   * Process all existing logs in the log directory.
   *
   * @param force - If true, recomputes all metrics even if they already exist
   */
  private async processExistingLogs(force: boolean = false): Promise<void> {
    logger.info({ force }, 'MetricsWorker: Reading existing log files');

    try {
      const files = await fs.readdir(this.logDir);
      const logFiles = files.filter((f) => f.endsWith('.json'));

      logger.info(
        { totalFiles: files.length, logFiles: logFiles.length, force },
        'MetricsWorker: Found log files in directory'
      );

      let processedCount = 0;
      let errorCount = 0;

      for (const file of logFiles) {
        try {
          logger.debug({ file, force }, 'MetricsWorker: Processing existing log file');
          await this.processLogFile(file, force);
          processedCount++;
        } catch (error) {
          logger.error({ file, error }, 'MetricsWorker: Error processing existing log file');
          errorCount++;
        }
      }

      logger.info(
        { total: logFiles.length, processed: processedCount, errors: errorCount, force },
        'MetricsWorker: Finished processing existing logs'
      );
    } catch (error) {
      logger.error({ error, logDir: this.logDir }, 'MetricsWorker: Error reading log directory');
    }
  }

  /**
   * Start watching the log directory for new files.
   */
  private startWatching(): void {
    try {
      logger.info({ logDir: this.logDir }, 'MetricsWorker: Setting up file watcher');

      this.watcher = watch(this.logDir, async (eventType, filename) => {
        if (!filename) {
          logger.debug({ eventType }, 'MetricsWorker: File watch event with no filename');
          return;
        }

        if (!filename.endsWith('.json')) {
          logger.debug(
            { eventType, filename },
            'MetricsWorker: Ignoring non-JSON file in watch event'
          );
          return;
        }

        logger.debug(
          { eventType, filename },
          'MetricsWorker: File watch event for log file'
        );

        // Only process on 'rename' (new file) or 'change' events
        if (eventType === 'rename' || eventType === 'change') {
          logger.info({ eventType, filename }, 'MetricsWorker: Processing file from watch event');
          await this.processLogFile(filename);
        }
      });

      logger.info('MetricsWorker: File watcher started successfully');
    } catch (error) {
      logger.error({ error }, 'MetricsWorker: Error starting file watcher');
    }
  }

  /**
   * Start polling for unprocessed logs.
   * This catches any logs that might have been missed by the watcher.
   */
  private startPolling(): void {
    logger.debug('MetricsWorker: Setting up polling timer');

    this.pollTimer = setInterval(async () => {
      logger.debug('MetricsWorker: Starting poll cycle');
      await this.pollForUnprocessedLogs();
    }, this.pollInterval);
  }

  /**
   * Poll for logs that don't have metrics computed yet.
   */
  private async pollForUnprocessedLogs(): Promise<void> {
    try {
      logger.debug({ logDir: this.logDir }, 'MetricsWorker: Polling for unprocessed logs');

      const files = await fs.readdir(this.logDir);
      const logFiles = files.filter((f) => f.endsWith('.json'));

      logger.debug({ count: logFiles.length }, 'MetricsWorker: Found log files during poll');

      let checkedCount = 0;
      let needsProcessingCount = 0;
      let alreadyProcessingCount = 0;

      for (const file of logFiles) {
        // Skip if already processing
        if (this.processingQueue.has(file)) {
          alreadyProcessingCount++;
          logger.debug({ file }, 'MetricsWorker: Skipping file already in processing queue');
          continue;
        }

        checkedCount++;

        // Check if log needs processing
        const needsProcessing = await this.logNeedsProcessing(file);
        if (needsProcessing) {
          needsProcessingCount++;
          logger.info({ file }, 'MetricsWorker: Log needs processing, adding to queue');
          await this.processLogFile(file);
        }
      }

      if (needsProcessingCount > 0 || alreadyProcessingCount > 0) {
        logger.info(
          {
            total: logFiles.length,
            checked: checkedCount,
            needsProcessing: needsProcessingCount,
            alreadyProcessing: alreadyProcessingCount,
          },
          'MetricsWorker: Poll cycle completed'
        );
      }
    } catch (error) {
      logger.error({ error }, 'MetricsWorker: Error polling for unprocessed logs');
    }
  }

  /**
   * Check if a log file needs metrics processing.
   * Returns true if the log is missing any metrics that should be computed.
   */
  private async logNeedsProcessing(filename: string): Promise<boolean> {
    try {
      const filePath = path.join(this.logDir, filename);
      logger.debug({ filename, filePath }, 'MetricsWorker: Checking if log needs processing');

      const content = await fs.readFile(filePath, 'utf-8');
      const log = JSON.parse(content) as InteractionLog;

      logger.debug(
        {
          filename,
          path: log.path,
          hasToolMetrics: !!log.toolMetrics,
          hasCustomTokenUsage: !!log.tokenUsage.custom,
          hasAgentTag: !!log.agentTag,
        },
        'MetricsWorker: Log file parsed'
      );

      // Check if we have all expected metrics
      const analyzerNames = globalMetricsRegistry.getAnalyzerNames();
      logger.debug({ filename, analyzerNames }, 'MetricsWorker: Checking against analyzers');

      // Check for agent-tag first (applies to all endpoints)
      if (analyzerNames.includes('agent-tag') && !log.agentTag) {
        logger.debug(
          { filename, path: log.path },
          'MetricsWorker: Log needs processing (missing agentTag)'
        );
        return true;
      }

      if (log.path.includes('/messages')) {
        if (analyzerNames.includes('tool-metrics') && !log.toolMetrics) {
          logger.debug(
            { filename, path: log.path },
            'MetricsWorker: Log needs processing (missing toolMetrics)'
          );
          return true;
        }
        if (analyzerNames.includes('token-breakdown') && !log.tokenUsage.custom) {
          logger.debug(
            { filename, path: log.path },
            'MetricsWorker: Log needs processing (missing tokenUsage.custom)'
          );
          return true;
        }
      }

      logger.debug({ filename }, 'MetricsWorker: Log does not need processing');
      return false;
    } catch (error) {
      logger.error(
        { filename, error },
        'MetricsWorker: Error checking if log needs processing, assuming it does'
      );
      // If we can't read/parse the log, assume it needs processing
      return true;
    }
  }

  /**
   * Process a single log file.
   *
   * @param filename - Name of the log file to process
   * @param force - If true, recomputes all metrics even if they already exist
   */
  private async processLogFile(filename: string, force: boolean = false): Promise<void> {
    // Avoid duplicate processing
    if (this.processingQueue.has(filename)) {
      logger.debug({ filename }, 'MetricsWorker: File already in processing queue, skipping');
      return;
    }

    this.processingQueue.add(filename);
    logger.info(
      { filename, queueSize: this.processingQueue.size, force },
      'MetricsWorker: Added file to processing queue'
    );

    try {
      const filePath = path.join(this.logDir, filename);
      logger.debug({ filename, filePath }, 'MetricsWorker: Reading log file');

      // Read the log file
      const content = await fs.readFile(filePath, 'utf-8');
      const log = JSON.parse(content) as InteractionLog;

      logger.info(
        { filename, logId: log.id, path: log.path, force },
        'MetricsWorker: Parsed log file, running analyzers'
      );

      // Log what metrics already exist
      logger.info(
        {
          filename,
          hasToolMetrics: !!log.toolMetrics,
          hasCustomTokenUsage: !!log.tokenUsage.custom,
          hasAgentTag: !!log.agentTag,
          force,
        },
        'MetricsWorker: Current state before running analyzers'
      );

      // Run all analyzers (pass force flag)
      const startTime = Date.now();
      const results = await globalMetricsRegistry.analyzeAll(log, force);
      const duration = Date.now() - startTime;

      logger.info(
        {
          filename,
          analyzers: results.size,
          durationMs: duration,
          analyzerNames: Array.from(results.keys()),
          registeredAnalyzers: globalMetricsRegistry.getAnalyzerNames(),
          skippedAnalyzers: globalMetricsRegistry.getAnalyzerNames().filter(
            name => !results.has(name)
          ),
        },
        'MetricsWorker: Analyzers completed'
      );

      // Update log with computed metrics
      let updated = false;

      for (const [analyzerName, result] of results.entries()) {
        logger.info(
          {
            filename,
            analyzerName,
            hasResult: !!result,
            resultType: result ? typeof result : 'null',
            isError: result && typeof result === 'object' && 'error' in result,
          },
          'MetricsWorker: Processing analyzer result'
        );

        if (analyzerName === 'tool-metrics' && result && typeof result === 'object') {
          const hasError = 'error' in result;
          if (hasError) {
            logger.warn(
              { filename, error: (result as any).error },
              'MetricsWorker: tool-metrics analyzer returned error'
            );
          } else {
            const resultObj = result as any;
            logger.info(
              {
                filename,
                totalToolCalls: resultObj.totalToolCalls,
                totalToolResults: resultObj.totalToolResults,
                toolCount: resultObj.tools?.length,
              },
              'MetricsWorker: Adding tool metrics to log'
            );
            log.toolMetrics = resultObj;
            updated = true;
          }
        } else if (analyzerName === 'token-breakdown' && result && typeof result === 'object') {
          const hasError = 'error' in result;
          if (hasError) {
            logger.warn(
              { filename, error: (result as any).error },
              'MetricsWorker: token-breakdown analyzer returned error'
            );
          } else {
            const resultObj = result as any;
            // The analyzer returns { system_totals, custom } but we only want the custom part
            const customData = resultObj.custom;
            logger.info(
              {
                filename,
                inputTokens: customData.input?.totalTokens,
                outputTokens: customData.output?.totalTokens,
                totalTokens: customData.totalTokens,
              },
              'MetricsWorker: Adding custom token usage to log'
            );
            log.tokenUsage.custom = customData;
            updated = true;
          }
        } else if (analyzerName === 'agent-tag' && result && typeof result === 'object') {
          const hasError = 'error' in result;
          if (hasError) {
            logger.warn(
              { filename, error: (result as any).error },
              'MetricsWorker: agent-tag analyzer returned error'
            );
          } else {
            const resultObj = result as any;
            logger.info(
              {
                filename,
                agentId: resultObj.id,
                agentLabel: resultObj.label,
              },
              'MetricsWorker: Adding agent tag to log'
            );
            log.agentTag = resultObj;
            updated = true;
          }
        }
      }

      // Write back to file if updated
      if (updated) {
        logger.info({ filename }, 'MetricsWorker: Writing updated log back to file');
        await fs.writeFile(filePath, JSON.stringify(log, null, 2), 'utf-8');
        logger.info(
          { filename, analyzers: results.size },
          'MetricsWorker: Successfully updated log with metrics'
        );
      } else {
        logger.debug({ filename }, 'MetricsWorker: No metrics to update');
      }
    } catch (error) {
      logger.error(
        { filename, error, stack: error instanceof Error ? error.stack : undefined },
        'MetricsWorker: Error processing log file'
      );
    } finally {
      this.processingQueue.delete(filename);
      logger.debug(
        { filename, queueSize: this.processingQueue.size },
        'MetricsWorker: Removed file from processing queue'
      );
    }
  }

  /**
   * Recompute metrics for all existing logs.
   * This forces recomputation even if metrics already exist.
   */
  async recomputeAll(): Promise<void> {
    logger.info('MetricsWorker: Recomputing all logs (forced)');
    await this.processExistingLogs(true);
  }

  /**
   * Get current status of the worker.
   */
  getStatus() {
    const status = {
      isRunning: this.isRunning,
      queueSize: this.processingQueue.size,
      registeredAnalyzers: globalMetricsRegistry.getAnalyzerNames(),
    };

    logger.debug(status, 'MetricsWorker: Status requested');
    return status;
  }
}

/**
 * Global singleton metrics worker instance.
 */
export let globalMetricsWorker: MetricsWorker | null = null;

/**
 * Initialize and start the global metrics worker.
 */
export async function startMetricsWorker(options?: MetricsWorkerOptions): Promise<MetricsWorker> {
  if (globalMetricsWorker) {
    logger.warn('MetricsWorker: Worker already initialized, returning existing instance');
    return globalMetricsWorker;
  }

  logger.info({ options }, 'MetricsWorker: Initializing global worker');
  globalMetricsWorker = new MetricsWorker(options);
  await globalMetricsWorker.start();
  return globalMetricsWorker;
}

/**
 * Stop the global metrics worker.
 */
export async function stopMetricsWorker(): Promise<void> {
  if (globalMetricsWorker) {
    logger.info('MetricsWorker: Stopping global worker');
    await globalMetricsWorker.stop();
    globalMetricsWorker = null;
  } else {
    logger.warn('MetricsWorker: No global worker to stop');
  }
}
