import type { Request, Response, NextFunction } from 'express';
import { logger } from '../logger';
import { ERROR_MESSAGES } from '../constants';

/**
 * Centralized error handler ensures we never leak stack traces to the client.
 */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error({ err: error }, 'unhandled server error');
  res.status(500).json({
    error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR,
  });
}
