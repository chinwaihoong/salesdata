# Static dashboard artifact

A self-contained HTML dashboard published as a Claude Artifact (hosted on
claude.ai, no server needed). It embeds aggregated data from
`data/database-dump.sql` — a snapshot, refreshed whenever new monthly files
are imported.

Published at: https://claude.ai/code/artifact/d4fb070a-b4be-4f10-a041-4b89a3a40b6a

## Monthly refresh workflow

1. Import the new Shopee/Lazada Excel files (via the app, or ask Claude to
   parse them with `server/importer.ts` logic) and update
   `data/database-dump.sql` with the new rows.
2. Rebuild the aggregate data:
   ```bash
   pnpm exec tsx artifact/build-data.ts     # writes artifact/dashboard-data.json
   ```
3. Splice it into the template:
   ```bash
   node -e "
   const fs=require('fs');
   const html=fs.readFileSync('artifact/dashboard.template.html','utf8');
   const json=JSON.stringify(JSON.parse(fs.readFileSync('artifact/dashboard-data.json','utf8'))).replace(/</g,'\\\\u003c');
   fs.writeFileSync('artifact/sales-dashboard.html',html.replace('__DATA_JSON__',json));
   "
   ```
4. Republish `artifact/sales-dashboard.html` to the same artifact URL
   (in a Claude session: publish with the existing URL to keep the link).

Notes:
- Brands are recomputed from product names at build time using the
  word-boundary `extractBrand` (the dump's stored brand column predates that
  fix; run `fix-brands.ts` against the live DB to correct it there).
- `artifact/dashboard-data.json` and `artifact/sales-dashboard.html` are
  build outputs; the template and build script are the sources.
