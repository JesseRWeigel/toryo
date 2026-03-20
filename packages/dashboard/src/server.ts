import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { watch } from 'chokidar';
import { readFile, writeFile, readdir, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, extname, basename } from 'node:path';
import type { WSContext } from 'hono/ws';

// --- Configuration ---
const PORT = parseInt(process.env.TORYO_DASH_PORT || '3100', 10);
const OUTPUT_DIR = resolve(process.env.TORYO_OUTPUT_DIR || '.toryo');
const METRICS_FILE = join(OUTPUT_DIR, 'metrics.json');
const RESULTS_FILE = join(OUTPUT_DIR, 'results.tsv');

// --- Client HTML ---
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadClientHTML(): string {
  // Try src directory first (dev mode), then dist directory
  const candidates = [
    join(__dirname, 'client.html'),
    join(__dirname, '..', 'src', 'client.html'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, 'utf-8');
  }
  return '<h1>client.html not found</h1>';
}

const CLIENT_HTML = loadClientHTML();

// --- Data reading helpers ---

interface ResultRow {
  timestamp: string;
  cycle: number;
  task: string;
  agent: string;
  score: number;
  status: string;
  description: string;
}

interface GlobalMetrics {
  cyclesCompleted: number;
  totalTasks: number;
  successRate: number;
  agents: Record<string, {
    agentId: string;
    tasksCompleted: number;
    avgScore: number;
    scores: number[];
    successRate: number;
  }>;
}

async function readMetrics(): Promise<GlobalMetrics | null> {
  try {
    if (!existsSync(METRICS_FILE)) return null;
    const raw = await readFile(METRICS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readResults(): Promise<ResultRow[]> {
  try {
    if (!existsSync(RESULTS_FILE)) return [];
    const raw = await readFile(RESULTS_FILE, 'utf-8');
    const lines = raw.trim().split('\n');
    if (lines.length < 2) return [];
    // Skip header line
    return lines.slice(1).map((line) => {
      const parts = line.split('\t');
      return {
        timestamp: parts[0] || '',
        cycle: parseInt(parts[1] || '0', 10),
        task: parts[2] || '',
        agent: parts[3] || '',
        score: parseFloat(parts[4] || '0'),
        status: parts[5] || '',
        description: parts[6] || '',
      };
    }).filter(r => !isNaN(r.cycle));
  } catch {
    return [];
  }
}

// --- Hono app ---

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// Track connected clients
const clients = new Set<WSContext>();

// Serve dashboard HTML
app.get('/', (c) => {
  return c.html(CLIENT_HTML);
});

// REST API endpoints
app.get('/api/metrics', async (c) => {
  const metrics = await readMetrics();
  return c.json(metrics || {});
});

app.get('/api/results', async (c) => {
  const results = await readResults();
  return c.json(results);
});

// Config endpoint — provides agent adapter/model info for the dashboard
const CONFIG_FILE = resolve(process.env.TORYO_CONFIG_FILE || 'toryo.config.json');

app.get('/api/config', async (c) => {
  try {
    if (!existsSync(CONFIG_FILE)) return c.json({});
    const raw = await readFile(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(raw);
    // Only expose agent configs (not secrets)
    return c.json({ agents: config.agents || {} });
  } catch {
    return c.json({});
  }
});

// --- Spec editor API ---

const SPECS_DIR = resolve(process.env.TORYO_SPECS_DIR || 'specs');

/** Resolve a spec path and verify it stays within SPECS_DIR (prevents path traversal) */
function safeSpecPath(id: string): string | null {
  const filePath = resolve(SPECS_DIR, `${id}.md`);
  if (!filePath.startsWith(resolve(SPECS_DIR) + '/')) return null;
  return filePath;
}

app.get('/api/specs', async (c) => {
  try {
    if (!existsSync(SPECS_DIR)) return c.json([]);
    const files = await readdir(SPECS_DIR);
    const specs = [];
    for (const file of files.filter((f) => extname(f) === '.md').sort()) {
      const content = await readFile(join(SPECS_DIR, file), 'utf-8');
      specs.push({ id: basename(file, '.md'), filename: file, content });
    }
    return c.json(specs);
  } catch {
    return c.json([]);
  }
});

app.get('/api/specs/:id', async (c) => {
  const id = c.req.param('id');
  const filePath = safeSpecPath(id);
  if (!filePath) return c.json({ error: 'Invalid spec ID' }, 400);
  try {
    const content = await readFile(filePath, 'utf-8');
    return c.json({ id, filename: `${id}.md`, content });
  } catch {
    return c.json({ error: 'Spec not found' }, 404);
  }
});

app.put('/api/specs/:id', async (c) => {
  const id = c.req.param('id');
  const filePath = safeSpecPath(id);
  if (!filePath) return c.json({ error: 'Invalid spec ID' }, 400);
  const body = await c.req.json<{ content: string }>();
  if (!body.content) return c.json({ error: 'content is required' }, 400);

  await mkdir(SPECS_DIR, { recursive: true });
  await writeFile(filePath, body.content, 'utf-8');
  return c.json({ id, filename: `${id}.md`, saved: true });
});

app.post('/api/specs', async (c) => {
  const body = await c.req.json<{ id: string; content: string }>();
  if (!body.id || !body.content) return c.json({ error: 'id and content are required' }, 400);

  const safeId = body.id.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  await mkdir(SPECS_DIR, { recursive: true });
  const filePath = join(SPECS_DIR, `${safeId}.md`);

  if (existsSync(filePath)) return c.json({ error: 'Spec already exists' }, 409);

  await writeFile(filePath, body.content, 'utf-8');
  return c.json({ id: safeId, filename: `${safeId}.md`, saved: true }, 201);
});

app.delete('/api/specs/:id', async (c) => {
  const id = c.req.param('id');
  const filePath = safeSpecPath(id);
  if (!filePath) return c.json({ error: 'Invalid spec ID' }, 400);
  try {
    await unlink(filePath);
    return c.json({ id, deleted: true });
  } catch {
    return c.json({ error: 'Spec not found' }, 404);
  }
});

// WebSocket endpoint
app.get(
  '/ws',
  upgradeWebSocket(() => ({
    onOpen(_event, ws) {
      clients.add(ws);
      console.log(`[dashboard] Client connected (${clients.size} total)`);
    },
    onClose(_event, ws) {
      clients.delete(ws);
      console.log(`[dashboard] Client disconnected (${clients.size} total)`);
    },
    onMessage(event, ws) {
      // Handle ping/pong or ignore
      const data = typeof event.data === 'string' ? event.data : '';
      if (data === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    },
  }))
);

function broadcast(data: object) {
  const msg = JSON.stringify(data);
  for (const ws of clients) {
    try {
      ws.send(msg);
    } catch {
      clients.delete(ws);
    }
  }
}

// --- File watching ---

async function pushFullState() {
  const [metrics, results] = await Promise.all([readMetrics(), readResults()]);
  broadcast({
    type: 'state:full',
    metrics: metrics || null,
    results,
    timestamp: new Date().toISOString(),
  });
}

// Watch the output directory for changes
if (existsSync(OUTPUT_DIR)) {
  const watcher = watch([METRICS_FILE, RESULTS_FILE], {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  watcher.on('change', async (path) => {
    console.log(`[dashboard] File changed: ${path}`);
    await pushFullState();
  });

  watcher.on('add', async (path) => {
    console.log(`[dashboard] File added: ${path}`);
    await pushFullState();
  });

  console.log(`[dashboard] Watching ${OUTPUT_DIR} for changes`);
} else {
  console.log(`[dashboard] Output dir ${OUTPUT_DIR} does not exist yet — no file watching`);
}

// --- Start server ---

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`
  ┌─────────────────────────────────────────┐
  │  棟梁 Toryo Dashboard                   │
  │  http://localhost:${info.port}                 │
  │  Watching: ${OUTPUT_DIR}
  └─────────────────────────────────────────┘
  `);
});

injectWebSocket(server);
