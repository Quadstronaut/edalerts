# EDAlerts — Fix & Single-Container Plan

## Root Cause Summary

The app fails to run for these concrete reasons, in order of severity:

| # | Component | Problem | Impact |
|---|-----------|---------|--------|
| 1 | `api/listen.js` | `zeromq@5` uses deprecated `.socket('sub')` API that is broken on Node > 12 | Listener never connects to EDDN; no alerts ever fire |
| 2 | `api/package.json` | Node 12 base image (EOL Apr 2022); zeromq v5 native bindings fail to compile against modern Node | Container crashes at startup |
| 3 | `api/package.json` | `request` + `request-promise` are archived/deprecated; no longer install cleanly | `npm install` warnings, potential silent failures |
| 4 | `api/package.json` | `zlib` listed as a dependency; it is a Node built-in with no npm package — installs a stub | Phantom dep causes confusion |
| 5 | `api/index.js` + `listen.js` | `mongoose.connect()` passes `useNewUrlParser`, `useFindAndModify`, `useUnifiedTopology` — all removed in Mongoose 6+ | DB connection throws on modern Mongoose |
| 6 | `site/package.json` | `next@^12` + `react@18` + `styled-components@6` — Next 12 has only experimental React 18 support; SC v6 causes SSR hydration errors | Frontend renders broken or blank |
| 7 | `site/Dockerfile` | Node 16 base (EOL Sep 2023) | Security exposure; may fail npm installs |

Everything else (business logic, route structure, MongoDB schema, Docker Compose orchestration) is sound and can be preserved.

---

## Phase 1 — Dependency Migrations

### 1.1 API / Listener (`api/package.json`)

| Package | Old | New | Reason |
|---------|-----|-----|--------|
| Node (base image) | 12 | 20 LTS | Supported, required for zeromq v6 |
| `zeromq` | `^5.2.8` | `^6.0.0` | v6 is async-iterable, stable, ships prebuilt binaries |
| `mongoose` | `^5.9.25` | `^8.x` | v5 is 4 years old; v8 drops deprecated options |
| `request` | `^2.88.2` | _(remove)_ | Archived; replaced by native `fetch` (Node 18+) |
| `request-promise` | `^4.2.5` | _(remove)_ | Same as above |
| `zlib` | `^1.0.5` | _(remove)_ | Built-in Node module; no npm package needed |

Keep as-is: `express`, `cors`, `body-parser`, `chalk`, `memoizee`, `morgan`, `dotenv`, `ws`, `nodemon`.

### 1.2 Web Frontend (`site/package.json`)

| Package | Old | New | Reason |
|---------|-----|-----|--------|
| Node (base image) | 16 | 20 LTS | Supported |
| `next` | `^12.3.4` | `^14.x` | Full React 18 support; built-in SC compiler |
| `request` | `^2.88.2` | _(remove)_ | Not used in frontend code |
| `request-promise` | `^4.2.5` | _(remove)_ | Not used in frontend code |
| `babel-plugin-styled-components` | `^1.10.7` | _(remove)_ | Next 14 SWC handles SC natively |

Keep: `react@18`, `react-dom@18`, `styled-components@6`, `styled-system`, `rebass`, `moment`, `@styled-icons/boxicons-regular`, `@svgr/webpack`.

---

## Phase 2 — Code Changes Required

### 2.1 `api/listen.js` — ZeroMQ v6 Migration (breaking API change)

zeromq v6 replaces the callback/event model with async iteration.

**Before:**
```javascript
const zmq = require('zeromq')
const sock = zmq.socket('sub')
sock.connect('tcp://eddn.edcd.io:9500')
sock.subscribe('')
sock.on('message', async (msg) => {
  // process msg
})
```

**After:**
```javascript
const { Subscriber } = require('zeromq')

async function startListener() {
  const sock = new Subscriber()
  await sock.connect('tcp://eddn.edcd.io:9500')
  sock.subscribe('')
  for await (const [msg] of sock) {
    try {
      // process msg — same logic, wrapped in try/catch
    } catch (e) {
      console.error('message processing error:', e.message)
    }
  }
}
```

The `mongoose.connection.once('open', ...)` block that currently wraps the listener startup is replaced with a top-level `async` runner that awaits DB connection before starting the ZMQ loop.

### 2.2 `api/index.js` + `api/listen.js` — Mongoose v8 Options Removal

**Before:**
```javascript
mongoose.connect(process.env.MONGO_URL, {
  useNewUrlParser: true,
  useFindAndModify: false,
  useUnifiedTopology: true,
})
```

**After:**
```javascript
mongoose.connect(process.env.MONGO_URL)
```

No other changes needed; the connection retry logic stays.

### 2.3 `api/controllers/alerts.js` + `api/listen.js` — Replace `request-promise` with Native `fetch`

Node 20 has `fetch` built in. All HTTP calls are simple POST/GET requests.

**Before:**
```javascript
const request = require('request-promise')
await request({ uri: webhookUrl, method: 'post', json: { embeds: [...] } })
```

**After:**
```javascript
const res = await fetch(webhookUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  signal: AbortSignal.timeout(5000),   // adds missing timeout
  body: JSON.stringify({ embeds: [...] }),
})
if (!res.ok) throw new Error(`webhook returned ${res.status}`)
```

`signal: AbortSignal.timeout(5000)` also fixes the missing request timeout bug.

### 2.4 `site/next.config.js` — Enable SWC Styled-Components Compiler

**Before:**
```javascript
module.exports = { reactStrictMode: true, eslint: { ignoreDuringBuilds: true } }
```

**After:**
```javascript
module.exports = {
  compiler: { styledComponents: true },  // replaces babel-plugin-styled-components
  eslint: { ignoreDuringBuilds: true },
}
```

Delete (or empty) `site/.babelrc` — the SWC compiler handles SC transforms; keeping `.babelrc` forces Next 14 to use Babel, disabling SWC.

### 2.5 `site/.babelrc` — Remove Babel config

Next 14's SWC compiler replaces `babel-plugin-styled-components`. Delete `.babelrc` at the site level (or remove the `babel-plugin-styled-components` preset from it). The root `.babelrc` can stay for linting purposes.

---

## Phase 3 — Single-Container Architecture

### Design Goals
- `docker run -e SITE_URL=... -e NEXT_PUBLIC_API_BASE=... -p 3000:3000 -p 3001:3001 edalerts`
- No docker-compose required; no external MongoDB required
- External MongoDB still supported via `MONGO_URL` env var override
- `NEXT_PUBLIC_API_BASE` is baked in at build time for browser-side fetch calls

### Container Layout

```
Single container
├── mongod (optional, started if MONGO_URL not set)
├── Node process: next start  (port 3000) ─┐
├── Node process: node index.js (port 3001) ├─ managed by pm2
└── Node process: node listen.js           ─┘
```

Process manager: **pm2** — lightweight, handles restarts, logs to stdout.

### Port Exposure

| Port | Service |
|------|---------|
| 3000 | Next.js web frontend |
| 3001 | Express REST API |

Both ports are exposed; the browser needs to reach 3001 directly for the client-side stats fetches.

### MongoDB Strategy

Entrypoint script logic:
```
if MONGO_URL is set:
    skip mongod startup, use provided connection
else:
    start mongod as background process
    wait until mongod accepts connections
    export MONGO_URL=mongodb://127.0.0.1:27017/edalerts
```

This makes the container fully self-contained by default, while remaining compatible with an external MongoDB instance (e.g., Atlas).

---

## Phase 4 — Dockerfile (Single Image)

### Multi-Stage Build

```
Stage 1: builder (node:20)
  - Install site/node_modules
  - NEXT_PUBLIC_API_BASE baked in via ARG
  - Run `next build`
  - Output: site/.next + site/public

Stage 2: runtime (node:20)
  - Install MongoDB from apt (mongodb-org)
  - Install pm2 globally
  - Install api/node_modules (production only)
  - Copy built Next.js from builder
  - Copy api/ source
  - Copy entrypoint.sh + pm2.config.js
  - EXPOSE 3000 3001
  - CMD ["/entrypoint.sh"]
```

### `pm2.config.js`
```javascript
module.exports = {
  apps: [
    { name: 'api',      script: 'api/index.js' },
    { name: 'listener', script: 'api/listen.js' },
    { name: 'web',      script: 'node_modules/.bin/next',
                        args:   'start site',
                        env:    { PORT: 3000 } },
  ],
}
```

### `entrypoint.sh`
```bash
#!/bin/bash
set -e

if [ -z "$MONGO_URL" ]; then
  mkdir -p /data/db
  mongod --fork --logpath /var/log/mongod.log --dbpath /data/db
  until mongosh --quiet --eval "db.adminCommand('ping')" &>/dev/null; do
    sleep 0.5
  done
  export MONGO_URL="mongodb://127.0.0.1:27017/edalerts"
fi

exec pm2-runtime pm2.config.js
```

---

## Phase 5 — Build & Run Instructions

### Build
```bash
docker build \
  --build-arg NEXT_PUBLIC_API_BASE=http://<your-host>:3001 \
  -t edalerts \
  .
```

`NEXT_PUBLIC_API_BASE` must point to wherever port 3001 will be accessible from the browser (not from inside the container). For local use: `http://localhost:3001`.

### Run (self-contained, with internal MongoDB)
```bash
docker run -d \
  -e SITE_URL=http://localhost \
  -p 3000:3000 \
  -p 3001:3001 \
  -v edalerts-data:/data/db \
  edalerts
```

### Run (external MongoDB, e.g., Atlas)
```bash
docker run -d \
  -e SITE_URL=http://myhost.com \
  -e MONGO_URL="mongodb+srv://user:pass@cluster.mongodb.net/edalerts" \
  -p 3000:3000 \
  -p 3001:3001 \
  edalerts
```

### Data persistence
Mount `/data/db` as a named volume to survive container restarts when using the internal MongoDB.

---

## Execution Order

1. **Update `api/package.json`** — bump zeromq, mongoose; remove request/request-promise/zlib
2. **Update `site/package.json`** — bump next to 14; remove request/request-promise/babel-plugin-sc
3. **Rewrite `api/listen.js`** — ZMQ v6 async-iterable pattern + native fetch + mongoose v8 options
4. **Update `api/index.js`** — mongoose v8 options; remove request import in controllers
5. **Update `api/controllers/alerts.js`** — replace request-promise with fetch
6. **Update `site/next.config.js`** — add `compiler.styledComponents`, remove babel config
7. **Delete/empty `site/.babelrc`** — let SWC take over
8. **Write root `Dockerfile`** — multi-stage, MongoDB install, pm2
9. **Write `entrypoint.sh`** — mongod conditional start + pm2-runtime
10. **Write `pm2.config.js`** — three app processes
11. **Test build** — `docker build --build-arg NEXT_PUBLIC_API_BASE=http://localhost:3001 -t edalerts .`
12. **Test run** — `docker run -p 3000:3000 -p 3001:3001 -e SITE_URL=http://localhost edalerts`
13. **Verify** — open `http://localhost:3000`, create a test alert, check listener logs via `docker logs`

---

## What Is Not Changed

- All alert business logic in `listen.js` (commodity matching, price evaluation, supply/demand filters, pad size, planetary/fleet carrier flags, frequency throttling)
- MongoDB schemas (`Alert.js`, `Trigger.js`)
- All API routes and controllers (beyond the `request` → `fetch` swap)
- All frontend pages and components
- `stations.json` / `commodities.json` / `rarecommodities.json` reference data
- The `DISABLE_WEBHOOKS` escape hatch for safe testing
