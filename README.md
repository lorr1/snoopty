# Snoopty

<p align="center">
<img src="assets/logo.png" alt="Snoopty" width="200">
</p>

What to know exactly what Claude Code is doing? Snoopty is a proxy server and visualization tool for Claude Code. Snoopty intercepts API requests from Claude Code, logs all interactions locally, and provides an interactive dashboard to analyze usage patterns, token consumption, and tool usage.

## Features

### Timeline View of All Requests and Responses
![Timeline View](assets/timeline.png)

See all the messages from Claude Code with agent tagging, token counts, and various UX filtering mechanisms.

### Dashboards

![Dashboard View](assets/dashboard.png)

For a given selection of logs, look at aggregate metrics of token counts and tool usage.

## Quick Start

### Prerequisites

- Node.js 18+
- An Anthropic API key

### Installation

```bash
npm install
```

### Configuration

Create a `.env` file from `.env.example`:

```env
UPSTREAM_API_KEY="sk-ant-XXX"
UPSTREAM_BASE_URL=https://api.anthropic.com
PORT=8787
LOG_DIR=logs
LOG_LEVEL=info
```

### Running

**Development** (with hot-reload):
```bash
# Terminal 1 - Backend proxy server
npm run dev

# Terminal 2 - Frontend dev server
npm run build:ui -- --watch
```

**Production**:
```bash
npm run build
npm start
```

The proxy runs on `http://localhost:8787` and the UI is available at `http://localhost:8787/ui` (or `http://localhost:5173` in dev mode).

### Using the Proxy

Point your Anthropic client to the proxy:

```bash
# Before
export ANTHROPIC_BASE_URL=https://api.anthropic.com

# After
export ANTHROPIC_BASE_URL=http://localhost:8787
```

All requests will be forwarded to Anthropic and logged locally.

![Details Panel](assets/details-panel.png)

## Architecture

- **Backend**: Node.js + Express + TypeScript
- **Frontend**: React 19 + Vite
- **Logs**: JSON files in `logs/` directory
- **Metrics**: Asynchronous background processing with pluggable analyzers

## Development

See [CLAUDE.md](CLAUDE.md) for detailed architecture documentation and development guidance.

## License

MIT
