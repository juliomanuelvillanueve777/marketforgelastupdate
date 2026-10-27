# MarketForge

Multi-marketplace SaaS platform (Airbnb-style public listing pages + admin dashboard).

## Stack
- Node.js + Express
- SQLite (`data/marketforge.db`)
- Optional MongoDB sync for Airbnb clone (`AIRBNB_CLONE_URL`)
- Caddy reverse proxy

## Quick start
```bash
cp .env.example .env
# edit .env
npm install
npm start
# listens on PORT (default 3000)
```

## Database
- Live DB: `data/marketforge.db`
- SQL export: `database_dump.sql`
  ```bash
  sqlite3 data/marketforge.db < database_dump.sql
  ```

## Main routes
- `/admin` — admin panel
- `/dashboard` — client dashboard
- `/rooms/:code` — public Airbnb-style listing
- `/book/stays/:code` — checkout

## Production
- Host: lessjob.online
- Process: `node server.js` (port 3000)
