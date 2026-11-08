#!/usr/bin/env node

/**
 * Config Studio — Real-Time Debug Telemetry Server
 * Listens on port 9998, pairs User Actions with Program Responses via Correlation ID,
 * and streams colorized causality logs to console, data/debug_stream.log, and data/debug_stream.jsonl.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.DEBUG_PORT, 10) || 9998;
const DATA_DIR = path.join(__dirname, '..', 'data');
const LOG_FILE = path.join(DATA_DIR, 'debug_stream.log');
const JSONL_FILE = path.join(DATA_DIR, 'debug_stream.jsonl');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory ring buffer of events
const MAX_BUFFER = 500;
const eventBuffer = [];
let totalEventsReceived = 0;

// Track active correlations for grouped output
const activeCorrelations = new Map();

// ANSI color codes
const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
};

function formatConsoleEvent(evt) {
  const time = evt.ts ? evt.ts.split('T')[1].replace('Z', '') : new Date().toISOString();
  const corr = evt.corrId ? `[${evt.corrId}]` : '';

  switch (evt.kind) {
    case 'USER_ACTION':
      return `${C.bold}${C.cyan}[${time}] 👉 USER ACTION ${corr} ${evt.label}${C.reset}`;

    case 'API_REQ':
      return `  ${C.gray}├── 📡 API REQ:${C.reset} ${evt.label} ${evt.details?.bodySnippet ? `${C.dim}${evt.details.bodySnippet}${C.reset}` : ''}`;

    case 'API_RES': {
      const status = evt.details?.status || 200;
      const statusColor = status >= 400 ? C.red : C.green;
      const dur = evt.durationMs !== undefined ? `(${evt.durationMs}ms)` : '';
      return `  ${C.gray}├── 📥 API RES:${C.reset} ${statusColor}${status}${C.reset} ${dur} ${evt.details?.bodySnippet ? `${C.dim}${evt.details.bodySnippet}${C.reset}` : ''}`;
    }

    case 'UI_MODAL':
      return `  ${C.gray}├── 🪟 UI MODAL:${C.reset} ${C.yellow}${evt.label}${C.reset}`;

    case 'UI_TOAST':
      return `  ${C.gray}├── 🔔 UI TOAST:${C.reset} ${C.magenta}${evt.label}${C.reset}`;

    case 'UI_TAB':
      return `  ${C.gray}├── 📑 UI TAB:${C.reset} ${C.blue}${evt.label}${C.reset}`;

    case 'MONACO_NAV':
      return `  ${C.gray}└── 🎯 MONACO:${C.reset} ${C.green}${evt.label}${C.reset}`;

    case 'PLUGIN_CALL':
      return `  ${C.gray}├── 🔌 PLUGIN:${C.reset} ${C.magenta}${evt.label}${C.reset}`;

    case 'RUNTIME_ERROR':
      return `  ${C.red}${C.bold}🚨 RUNTIME ERROR:${C.reset} ${C.red}${evt.label}${C.reset}\n     ${C.dim}${evt.details?.stack || ''}${C.reset}`;

    default:
      return `  ${C.gray}├── [${evt.kind}]:${C.reset} ${evt.label}`;
  }
}

function appendToFiles(evt, line) {
  try {
    const rawLine = line.replace(/\x1b\[[0-9;]*m/g, '') + '\n';
    fs.appendFileSync(LOG_FILE, rawLine, 'utf8');
    fs.appendFileSync(JSONL_FILE, JSON.stringify(evt) + '\n', 'utf8');
  } catch (_) {}
}

const server = http.createServer((req, res) => {
  // Setup CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Health endpoint
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        port: PORT,
        uptimeSeconds: Math.floor(process.uptime()),
        totalEventsReceived,
        bufferedCount: eventBuffer.length,
      })
    );
    return;
  }

  // Tail endpoint for AI Agent: GET /tail?n=20
  if (url.pathname === '/tail') {
    const n = parseInt(url.searchParams.get('n') || '20', 10);
    const recent = eventBuffer.slice(-n);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ count: recent.length, events: recent }, null, 2));
    return;
  }

  // Clear endpoint: POST or GET /clear
  if (url.pathname === '/clear') {
    eventBuffer.length = 0;
    try {
      fs.writeFileSync(LOG_FILE, '', 'utf8');
      fs.writeFileSync(JSONL_FILE, '', 'utf8');
    } catch (_) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'cleared' }));
    return;
  }

  // Events ingestion endpoint: POST /events
  if (url.pathname === '/events' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy(); // Protect against payloads > 1MB
      }
    });

    req.on('end', () => {
      try {
        const evt = JSON.parse(body);
        totalEventsReceived++;
        eventBuffer.push(evt);
        if (eventBuffer.length > MAX_BUFFER) {
          eventBuffer.shift();
        }

        const formatted = formatConsoleEvent(evt);
        console.log(formatted);
        appendToFiles(evt, formatted);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true, id: evt.id }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n==========================================================`);
  console.log(`  Config Studio — Real-Time Debug Telemetry Server`);
  console.log(`  Listening on: http://localhost:${PORT}`);
  console.log(`  Logs streaming to: ${LOG_FILE}`);
  console.log(`  Tail endpoint: http://localhost:${PORT}/tail?n=20`);
  console.log(`==========================================================\n`);
});
