/**
 * Shared constants for the Snoopty backend.
 */

// =============================================================================
// API Pagination
// =============================================================================

/** Default number of logs to return per page */
export const DEFAULT_LOG_LIMIT = 50;

/** Minimum allowed limit for log pagination */
export const MIN_LOG_LIMIT = 1;

/** Maximum allowed limit for log pagination */
export const MAX_LOG_LIMIT = 2000;

// =============================================================================
// Error Messages
// =============================================================================

export const ERROR_MESSAGES = {
  ROUTE_NOT_FOUND: 'Route not handled by snoopty proxy',
  INTERNAL_SERVER_ERROR: 'Internal server error',
  EXPORT_NO_LOGS: 'No log file names provided for export',
  DELETE_NO_LOGS: 'No log file names provided for deletion',
} as const;

// =============================================================================
// HTTP Status Codes
// =============================================================================

export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
} as const;
