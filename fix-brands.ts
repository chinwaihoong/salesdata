/**
 * One-time maintenance: recompute the brand column for every sales_orders row
 * using the word-boundary extractBrand fix (the old substring match tagged
 * names containing "JUNIOR" etc. as Uni). Safe to re-run; only mismatches are
 * updated. Run with: DATABASE_URL=... pnpm exec tsx fix-brands.ts
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { extractBrand } from "./server/importer";
import { canonicalizeBrand } from "./server/db";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, connectTimeout: 30000 });

  const [rows] = await conn.query("SELECT id, productName, brand FROM sales_orders") as any;
  const updates: { id: number; brand: string }[] = [];
  for (const r of rows) {
    const correct = canonicalizeBrand(extractBrand(r.productName));
    if (correct !== r.brand) updates.push({ id: r.id, brand: correct });
  }
  console.log(`${rows.length} rows checked, ${updates.length} need a brand correction`);

  const byBrand = new Map<string, number>();
  for (const u of updates) byBrand.set(u.brand, (byBrand.get(u.brand) || 0) + 1);
  for (const [b, n] of byBrand) console.log(`  -> ${b}: ${n} rows`);

  for (let i = 0; i < updates.length; i += 500) {
    const batch = updates.slice(i, i + 500);
    await Promise.all(batch.map(u =>
      conn.execute("UPDATE sales_orders SET brand = ? WHERE id = ?", [u.brand, u.id])
    ));
    console.log(`updated ${Math.min(i + 500, updates.length)}/${updates.length}`);
  }
  await conn.end();
  console.log("done");
}

main().catch(err => { console.error(err); process.exit(1); });
