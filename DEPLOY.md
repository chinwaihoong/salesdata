# Deploying the Sales Dashboard (independent of Manus)

The app is a single Node.js server (Express + tRPC) that also serves the built
React frontend, plus a MySQL database. It runs on any Node host; this guide
uses Railway because it hosts both the app and the MySQL database in one place
for roughly USD 5/month.

## What you need

- This GitHub repository (`chinwaihoong/salesdata`)
- The database dump in `data/database-dump.sql` (all historical orders)
- 15–30 minutes

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | MySQL connection string, e.g. `mysql://user:pass@host:3306/railway` |
| `JWT_SECRET` | yes | Signs admin session cookies. Generate: `openssl rand -hex 32` |
| `ADMIN_PASSWORD` | yes | Password for the Upload/admin area |
| `ADMIN_NAME` | no | Display name in the sidebar (default "Admin") |
| `PORT` | no | Set automatically by most hosts |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION` | no | Optional S3-compatible storage for keeping copies of uploaded Excel files. Leave unset — imports work without it |

## Option A: Railway (recommended)

1. Sign up at [railway.app](https://railway.app) with your GitHub account.
2. **New Project → Deploy from GitHub repo** → pick `chinwaihoong/salesdata`.
   Railway detects the Dockerfile and builds automatically.
3. In the same project: **Create → Database → MySQL**.
4. On the app service → **Variables**, add:
   - `DATABASE_URL` = reference the MySQL service's `MYSQL_URL` variable
     (Railway lets you insert `${{ MySQL.MYSQL_URL }}`)
   - `JWT_SECRET` = output of `openssl rand -hex 32`
   - `ADMIN_PASSWORD` = your chosen password
5. **Load the historical data** (one-time). From your own computer with the
   repo cloned, using the MySQL connection values shown on the Railway MySQL
   service ("Connect" tab):
   ```bash
   mysql -h <host> -P <port> -u root -p<password> railway < data/database-dump.sql
   ```
   (Or use any MySQL GUI like TablePlus/DBeaver and run the dump file.)
6. **Run migrations** so the newer columns/indexes exist. Locally, with
   `DATABASE_URL` pointed at the Railway database:
   ```bash
   pnpm install
   DATABASE_URL="mysql://root:<password>@<host>:<port>/railway" pnpm db:push
   ```
7. Open the app's public URL (Settings → Networking → Generate Domain).
   The dashboard should show all historical data. Go to **Upload Data**, sign
   in with your admin password, and future monthly files import as before.

## Option B: Render / Fly.io / any Docker host

The repo's `Dockerfile` is standard: build it and run it anywhere with the
environment variables above set. You'll need a MySQL database elsewhere —
[TiDB Cloud Serverless](https://tidbcloud.com) has a free tier that works
(the app was originally running on TiDB), as does Aiven's free MySQL.
Restore the dump and run `pnpm db:push` the same way as steps 5–6 above.

## Local development

```bash
cp .env.example .env      # fill in DATABASE_URL, JWT_SECRET, ADMIN_PASSWORD
pnpm install
pnpm db:push              # create/update tables
pnpm dev                  # http://localhost:3000
```

Tests and checks:

```bash
pnpm test                 # vitest suite
pnpm run check            # TypeScript
pnpm run build            # production build
```

## What was removed from the Manus version

- Manus OAuth login → replaced by a single admin password (`ADMIN_PASSWORD`)
  with locally signed JWT session cookies. Viewing the dashboard needs no login;
  uploading data does.
- Manus Forge S3 proxy → optional generic S3 storage (or none).
- Manus runtime/debug Vite plugins, demo template pages, and the LLM/maps/
  notification helpers the dashboard never used.
