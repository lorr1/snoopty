# Snoopty – Repository & Workflow Notes

## Project Overview

Snoopty is an Anthropic proxy and log viewer comprising:

- **Backend (`src/`)**
  - TypeScript `express` proxy (`server.ts`) that forwards `/v1/*` traffic to Anthropic, persists request/response pairs, exposes `/api/logs` CRUD endpoints, and can export filtered logs to Parquet via `hyparquet-writer`.
  - Support modules for configuration, logging, proxying, log storage, token analytics, and Parquet export.
- **Frontend (`client/`)**
  - React + Vite SPA displaying timelines, detailed payloads, time-range filters, bulk actions, and token usage summaries.
  - New timeline “brush” header for Logfire-style selection; Parquet exports and deletions target the filtered set.
  - Extensive debug logging (console) for fetch flow, selection state, and error handling.

## Execution Environment & Guidelines Followed

The work obeyed the Codex CLI instructions in this workspace:

1. **System / Developer Requirements**
   - Respect readonly sandbox, avoid destructive commands (no `git reset --hard`, etc.).
   - Use `apply_patch` for edits; prefer ASCII; add comments sparingly.
   - Provide concise, friendly final messages with testing hints.
   - Add file/line references when summarizing changes; avoid dumping large file contents.
   - Default to building/testing with `npm run build` or explicit scripts; highlight missing installs.

2. **Planning & Execution**
   - Maintain/update a multi-step plan for non-trivial tasks (`update_plan` usage).
   - Run shell commands via `["bash","-lc", ...]` with explicit `workdir`.
   - When network access failed (e.g., `npm install`), note it and continue using fallbacks or instructions.

3. **Debugging Strategy**
   - When minified bundle errors appeared (temporal dead-zone issues like `Cannot access 'Rt'` / `Ht'`), generate sourcemaps (`vite build --sourcemap`) and map offending columns back to source.
   - Introduced global error/rejection listeners and console diagnostics in React (`main.tsx`, `App.tsx`) to expose runtime flow.

4. **Parquet Export**
   - Added `hyparquet-writer` integration via `createParquetBuffer`, served through `/api/logs/export`.
   - Provided client-side download logic and surfaced server responses (missing logs, errors) in the UI.

## Quick Usage Notes

- **Dev Experience:** run the proxy (`npm run dev`) and the UI (if host binding permitted) or `npm run build && npm run start` for production. Logs appear under `logs/` JSON files.
- **Parquet Export:** Ensure `hyparquet-writer@^0.9.1` is installed once network is available.
- **Debugging:** Check the browser console for `[snoopty]` messages and global error handlers.

## Code Landmarks & Responsive Layout

- **Frontend entry points:** `client/src/main.tsx` wires error/rejection listeners, while `client/src/App.tsx` hosts all timeline, selection, and Interaction Details logic (tabs + token summaries). State is co-located there, so search within this file when debugging UI issues.
- **Styling:** `client/src/styles.css` drives the two-panel layout (left timeline, right detail). The default desktop view locks the shell/app-main to `100vh` for split scrolling, while media queries at `max-width: 1080px` and `max-height: 900px` flip the shell to auto-height so the whole page scrolls (required to see Interaction tabs on small screens).
- **Interaction payload panes:** `.details-code` enforces `width: 100%`, `max-width: 100%`, and wraps long tokens so Request/Response/Raw JSON views do not widen the column. Tweak these rules first if long payloads misbehave.
- **Backend focus:** `src/server.ts` exposes `/api/logs`, `/api/logs/export`, and `/v1/*` proxying. Support modules under `src/` manage config, persistence, analytics, and Parquet export.
- **Logs & storage:** JSON files live under `logs/`, referenced by filename in the UI for selection/deletion/export flows.

Keep these landmarks in mind before diving into new tasks so you can hop straight to the relevant file.

This file serves as a quick reference for future agents working inside the Codex CLI on this project. Feel free to extend it with additional conventions or tooling notes as the repository evolves.
