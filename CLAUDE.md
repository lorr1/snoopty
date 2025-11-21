# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Snoopty is an Anthropic API proxy server with a log viewer UI. It intercepts, records, and visualizes API interactions with Claude models.

## Build and Run Commands

```bash
# Development (run in separate terminals)
npm run dev              # Backend proxy with hot-reload (localhost:8787)
npm run dev:ui           # Frontend dev server (localhost:5173)

# Production
npm run build            # Build both backend (tsc) and frontend (vite)
npm run start            # Run production server

# Individual builds
npm run build:server     # TypeScript backend only
npm run build:ui         # Vite frontend only

# Utilities
npm run logs:tail        # Tail application logs
npm run preview:ui       # Preview built frontend
```

No test framework is configured yet (`npm test` is a placeholder).

## Architecture

**Backend**: Node.js + Express + TypeScript (`src/`)
**Frontend**: React 19 + Vite + TypeScript (`client/`)

### Request Flow

1. Client request → Express middleware
2. `/v1/*` routes → `proxyAnthropicRequest()` in `src/proxy.ts`
3. Injects `UPSTREAM_API_KEY`, forwards to Anthropic API
4. Streams response back, captures metadata
5. `writeInteractionLog()` in `src/logWriter.ts` writes to `logs/` as JSON
6. Frontend polls `/api/logs` with pagination and filtering

### Backend Modules (`src/`)

- `server.ts` - Express bootstrap, routes, middleware
- `proxy.ts` - Reverse proxy to Anthropic
- `logStore.ts` - Log CRUD with cursor-based pagination
- `logWriter.ts` - Persistence, InteractionLog type definitions
- `streamAggregator.ts` - SSE/NDJSON parsing for streaming responses
- `tokenMetrics.ts` - Token usage extraction from responses
- `tokenCounting.ts` - Per-role token estimation
- `agentTagger.ts` - Regex-based agent detection from system prompts
- `parquetExporter.ts` - Export logs to Parquet format
- `config.ts` - Environment configuration with defaults
- `logger.ts` - Pino structured logging setup

### Frontend (`client/src/`)

- `App.tsx` - Main component with all state, polling, filtering (large file)
- `components/TimelineBrush.tsx` - Time-range selection slider
- `components/ChatPreviewModal.tsx` - Message preview modal
- `utils/time.ts` - Date formatting utilities

### REST API Endpoints

- `GET /api/logs` - List logs (supports `limit`, `cursor` params)
- `GET /api/logs/{fileName}` - Fetch single log
- `DELETE /api/logs` - Batch delete by file names
- `POST /api/logs/export` - Export to Parquet
- `POST /api/logs/recompute` - Recompute token metrics
- `/v1/*` - Reverse proxy to Anthropic API
- `/ui` - React SPA (static)

## Configuration

Environment variables (from `.env`):

```
UPSTREAM_API_KEY or ANTHROPIC_API_KEY  # Required
UPSTREAM_BASE_URL   # Default: https://api.anthropic.com
PORT                # Default: 8787
LOG_DIR             # Default: logs
LOG_LEVEL           # Default: info
APP_LOG_FILE        # Default: logs/app.log (empty string disables)
```

## Key Implementation Details

**Agent Tagging**: `src/agentTagger.ts` defines regex rules in `TAG_RULES` array. Each tag has a theme (colors). Add new rules there for new agent types.

**Token Metrics**: Combines Anthropic-reported counts with estimates. `tokenMetrics.ts` extracts from responses, `tokenCounting.ts` estimates per-role breakdown.

**Stream Aggregation**: `streamAggregator.ts` reconstructs JSON from SSE chunks, handles text/tool_use/thinking content blocks. Complex edge cases—review carefully before modifying.

**Parquet Export**: Uses flat schema with stringified JSON fields for tool compatibility (DuckDB, Pandas).

**Frontend Polling**: `App.tsx` polls every 2s with cursor-based pagination. Client-side filtering by time range, endpoint type, and agent tag.

## Common Tasks

**Adding API endpoint**: Add handler in `src/server.ts` → `registerRoutes()`

**Adding agent detection rule**: Add to `TAG_RULES` in `src/agentTagger.ts` with matchers and theme

**Modifying token metrics**: Update `src/tokenMetrics.ts` (aggregation) and `src/tokenCounting.ts` (estimation), then update types in `src/logWriter.ts` and `client/src/App.tsx`
