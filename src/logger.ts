import pino from 'pino';
import { appConfig } from './config';

const transportTargets = appConfig.appLogFile
  ? [
      {
        level: appConfig.logLevel,
        target: 'pino/file',
        options: {
          destination: appConfig.appLogFile,
          mkdir: true,
          append: true,
        },
      },
      {
        level: appConfig.logLevel,
        target: 'pino/file',
        options: {
          destination: 1,
        },
      },
    ]
  : null;

export const logger = pino(
  transportTargets
    ? {
        level: appConfig.logLevel,
        transport: { targets: transportTargets },
      }
    : {
        level: appConfig.logLevel,
      }
);
