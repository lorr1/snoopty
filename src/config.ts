import { config as loadEnv } from 'dotenv';

loadEnv();

const DEFAULT_PORT = 8787;
const DEFAULT_UPSTREAM_URL = 'https://api.anthropic.com';
const DEFAULT_LOG_DIR = 'logs';
const DEFAULT_APP_LOG_FILE = 'logs/app.log';

export interface AppConfig {
  port: number;
  upstreamBaseUrl: string;
  upstreamApiKey: string | null;
  logDir: string;
  logLevel: string;
  appLogFile: string | null;
  isDevelopment: boolean;
}

function resolvePort(): number {
  const raw = process.env.PORT ?? `${DEFAULT_PORT}`;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : DEFAULT_PORT;
}

export const appConfig: AppConfig = {
  port: resolvePort(),
  upstreamBaseUrl: process.env.UPSTREAM_BASE_URL ?? DEFAULT_UPSTREAM_URL,
  upstreamApiKey:
    process.env.UPSTREAM_API_KEY ??
    process.env.ANTHROPIC_API_KEY ??
    null,
  logDir: process.env.LOG_DIR ?? DEFAULT_LOG_DIR,
  logLevel: process.env.LOG_LEVEL ?? 'info',
  appLogFile: process.env.APP_LOG_FILE === ''
    ? null
    : process.env.APP_LOG_FILE ?? DEFAULT_APP_LOG_FILE,
  // Check if running in development mode:
  // 1. NODE_ENV explicitly set to 'development'
  // 2. Running via ts-node-dev
  // 3. NOT explicitly set to 'production' AND has ts-node-dev markers
  isDevelopment: process.env.NODE_ENV === 'development' ||
    (process.env.NODE_ENV !== 'production' && (
      process.argv.some(arg => arg.includes('ts-node-dev')) ||
      process.argv[1]?.includes('ts-node-dev') ||
      !!process.env.TS_NODE_DEV
    )),
};

export function validateConfig(): void {
  if (!appConfig.upstreamApiKey) {
    throw new Error(
      'Missing UPSTREAM_API_KEY (or ANTHROPIC_API_KEY) environment variable required to talk to Anthropic.'
    );
  }
}
