# edalerts

Create Elite Dangerous commodity market alerts. Get notified via Discord when a specific commodity buys or sells above or below a price threshold at in-game stations. Market data is sourced live from [EDDN](https://github.com/EDCD/EDDN) (Elite Dangerous Data Network).

<img width="1466" alt="Screenshot 2025-02-26 at 14 26 55" src="https://github.com/user-attachments/assets/abde0245-1a17-4480-8b07-58ef214ebdfe" />

---

## How It Works

Four processes, one shared MongoDB:

```
EDDN (eddn.edcd.io:9500, ZMQ PUB/SUB)
  └─► Listener — evaluates alerts, fires Discord webhooks, logs triggers

MongoDB
  ├── alerts   — user-created alert configs
  └── triggers — audit log of sent notifications

API (Express, port 3001) — REST CRUD for alerts and trigger stats

Web (Next.js, port 3000) — alert creation form, manage/delete pages
```

Alerts are evaluated against real-time commodity data. When a match is found the listener POSTs a Discord embed to the configured webhook URL. Alerts throttle by a configurable frequency interval so you don't get spammed.

---

## Deployment — Single Container (recommended)

Everything runs in one image: Node 20, MongoDB 7, and all three Node processes managed by pm2. No docker-compose required.

### 1. Build

```bash
docker build \
  --build-arg NEXT_PUBLIC_API_BASE=http://<your-host>:3001 \
  -t edalerts \
  .
```

`NEXT_PUBLIC_API_BASE` is the URL your **browser** uses to reach the API. For local use that's `http://localhost:3001`. For a server replace with the public hostname or IP.

### 2. Run

```bash
docker run -d \
  --name edalerts \
  -e SITE_URL=http://<your-host> \
  -p 3000:3000 \
  -p 3001:3001 \
  -v edalerts-data:/data/db \
  edalerts
```

| Port | Service |
|------|---------|
| 3000 | Web frontend |
| 3001 | REST API |

The volume `edalerts-data` persists MongoDB data across restarts. Without it the database is lost when the container stops.

### 3. Open

Navigate to `http://<your-host>:3000`.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SITE_URL` | Yes | Base URL used in Discord embed links (e.g. `http://myserver.com`) |
| `NEXT_PUBLIC_API_BASE` | Build-time ARG | Browser-accessible API URL, baked in at `docker build` time |
| `MONGO_URL` | No | External MongoDB connection string. If unset, an internal MongoDB is started automatically |
| `DISABLE_WEBHOOKS` | No | Set to `true` to suppress Discord notifications (useful for testing) |

### Using an External MongoDB (optional)

Pass `MONGO_URL` at runtime to skip the internal MongoDB entirely:

```bash
docker run -d \
  --name edalerts \
  -e SITE_URL=http://myserver.com \
  -e MONGO_URL="mongodb+srv://user:pass@cluster.mongodb.net/edalerts" \
  -p 3000:3000 \
  -p 3001:3001 \
  edalerts
```

---

## Local Development

### API and Listener

```bash
cd api
npm install
npm run dev      # API on port 3001 with nodemon
npm run listen   # EDDN market listener
```

Requires `MONGO_URL` in a `.env` file or environment.

### Web Frontend

```bash
cd site
npm install
NEXT_PUBLIC_API_BASE=http://localhost:3001 npm run dev   # port 3000
```

### Linting

ESLint and Prettier are configured at the repo root.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 |
| Web frontend | Next.js 14, React 18, styled-components 6, Rebass |
| API | Express 4 |
| Market listener | ZeroMQ 6 (EDDN subscriber) |
| Database | MongoDB 7 (Mongoose 8) |
| Container | Docker, pm2-runtime |

---

## Resources

- [EDDN](https://github.com/EDCD/EDDN) — Elite Dangerous Data Network (live market data source)
- [Commodity list (FDevIDs)](https://github.com/EDCD/FDevIDs)
- [Station list (EDDB)](https://eddb.io/api)
