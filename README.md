# Snoopty

![Snoopty](assets/snoopty.png)

What to know exactly what Claude Code is doing? Snoopty is a proxy server and visualization tool for Claude Code. Snoopty intercepts API requests from Claude Code, logs all interactions locally, and provides an interactive dashboard to analyze usage patterns, token consumption, and tool usage.

## Features

### Timeline View of All Requests and Responses
![Timeline View](assets/timeline.png)

See all the messages from Claude Code with agent tagging, token counts, and various UX filtering mechanisms.

For token counts, we show the counts returned from Anthropic under `System Usage` and then show our custom token counting at a finer granularity under `Custom Counts`.

### Detailed Request View
![Chat Request View](assets/chat_request_detail.png)

For a single request, see in details each component, each tool, and estiamted token usage.

### Dashboards
![Dashboard View](assets/dashboard.png)

For a given selection of logs, look at aggregate metrics of token counts and tool usage. You can even dive into MCP versus Anthropic Default tools.

### Download to Parquet
What to do analysis elsewhere, hit the download to parquet function to get a dump of logs into a log dump. The logs dumped will only be those selected/filtered in the current view.

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
npm run dev:ui
```

**Production**:
```bash
npm run build
npm start
```

The proxy runs on `http://localhost:8787` and the UI is available at `http://localhost:8787/ui`.

### Using the Proxy

Point your Anthropic client to the proxy:

```bash
# Before
claude

# After
export ANTHROPIC_BASE_URL=http://localhost:8787 claude
```

Claude will complain about needing to logout. Ignore it it should work.

All requests will be forwarded to Anthropic and logged locally.


## Architecture

- **Backend**: Node.js + Express + TypeScript
- **Frontend**: React 19 + Vite
- **Logs**: JSON files in `logs/` directory
- **Metrics**: Asynchronous background processing with pluggable analyzers

## Special Thanks
Huge shout out to [Pydantic AI's Logifre](https://pydantic.dev/logfire). Their chat view was huge inspiration. Also thanks to [Hyperparam](https://hyperparam.app/home). I used their parquet view a lot in early investigations of logs.