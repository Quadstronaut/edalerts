# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## What This Repository Is

**EDAlerts** is a commodity market alerting system for Elite Dangerous. Players create alerts that fire Discord webhook notifications when specific commodities buy/sell at prices above/below a threshold at in-game stations. Market data is sourced from EDDN (Elite Dangerous Data Network) in real time.

---

## Development Commands

### Docker Compose (full stack)
```bash
docker compose up        # Start mongodb, api, listener, and web frontend
```
Edit environment variables directly in `docker-compose.yml` (parameterized with `SITE_URL` and `NEXT_PUBLIC_API_BASE`).

### API & Listener (from `api/`)
```bash
yarn install
yarn dev        # API + nodemon (port 3001)
yarn start      # API production
yarn listen     # Market listener (EDDN subscriber)
```

### Web Frontend (from `site/`)
```bash
yarn install
yarn dev        # Next.js dev server (port 3000)
yarn build      # Production build
yarn start      # Production server
```

### Linting / Formatting
ESLint and Prettier are configured at the root. No test suite is present.

---

## Required Environment Variables

**API / Listener:**
- `MONGO_URL` — MongoDB connection string (e.g. `mongodb://mongodb`)
- `SITE_URL` — Base URL used in Discord embed links
- `DISABLE_WEBHOOKS` — Set to `true` to suppress Discord notifications (optional)

**Web Frontend (build-time):**
- `NEXT_PUBLIC_API_BASE` — API base URL passed to the browser (e.g. `http://localhost:3001`)

---

## Architecture

Four processes, one shared MongoDB:

```
EDDN (eddn.edcd.io:9500, ZMQ PUB/SUB)
  └─► Listener (listen.js)
        ├── queries MongoDB for matching alerts
        ├── evaluates price/supply/pad/carrier/frequency conditions
        ├── POSTs Discord webhook notifications
        └── writes Trigger audit records

MongoDB
  ├── alerts   — user-created alert configs
  └── triggers — audit log of sent notifications

API (Express, port 3001)
  └── REST CRUD for alerts + trigger statistics

Web Frontend (Next.js, port 3000)
  └── form UI → POST /alert → API → MongoDB
      manage/delete pages → GET/DELETE /alert/…
```

**Key flows:**
- **Alert creation:** Frontend form → `POST /alert` → API validates Discord webhook (live test POST) → saves to MongoDB.
- **Alert triggering:** Listener receives ZMQ market message → decompress zlib → match commodity against all DB alerts → evaluate all conditions → POST Discord embed → record Trigger → update `lastSent` for frequency throttling.
- **No auth:** The service is fully public—no user accounts or API keys. Only validation is the Discord webhook URL format + live test.

---

## Key Files

| Path | Purpose |
|------|---------|
| `api/listen.js` | EDDN ZMQ subscriber; all alert evaluation and webhook dispatch logic lives here |
| `api/index.js` | Express API server + route wiring |
| `api/controllers/alerts.js` | Alert CRUD (create, read, delete, list-by-webhook) |
| `api/schema/Alert.js` | Mongoose schema — all alert fields and defaults |
| `api/stations.json` | ~32 MB offline station database (pad size, carrier/planetary flags) used during trigger evaluation |
| `site/pages/index.js` | Main alert-creation form + live stats display |
| `site/pages/manage/[webhook].js` | List/manage alerts by Discord webhook |

## Commodity Data

`commodities.json` and `rarecommodities.json` are duplicated in both `api/` and `site/` — each directory loads its own local copy. Do not consolidate them into a shared location without updating both import paths.

---

## Alert Frequency Throttling

The `freq` field on an Alert is a millisecond interval. The listener checks `alert.lastSent` before firing: if `Date.now() - lastSent < freq`, the alert is skipped. `freq: 0` means fire every time.

## Webhook Failure Handling

If a Discord webhook returns a non-2xx response (e.g. webhook deleted by user), the listener auto-deletes the Alert from MongoDB to stop retrying.
