/**
 * Parse data/database-dump.sql and emit aggregated JSON for the static
 * dashboard artifact. Reuses the app's canonicalizeBrand/shortenProductName.
 */
import * as fs from "fs";
import { canonicalizeBrand, shortenProductName } from "../server/db";
import { extractBrand } from "../server/importer";

const dump = fs.readFileSync("data/database-dump.sql", "utf-8");
const lines = dump.split("\n").filter(l => l.startsWith("INSERT INTO sales_orders"));

// Split a VALUES(...) body on top-level commas, respecting quotes and parens
function splitValues(body: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inStr = false;
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (c === "\\") { cur += c + (body[i + 1] ?? ""); i++; continue; }
      if (c === "'") {
        if (body[i + 1] === "'") { cur += "''"; i++; continue; }
        inStr = false;
      }
      cur += c;
      continue;
    }
    if (c === "'") { inStr = true; cur += c; continue; }
    if (c === "(") { depth++; cur += c; continue; }
    if (c === ")") { depth--; cur += c; continue; }
    if (c === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function unquote(v: string): string {
  if (v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1).replace(/\\'/g, "'").replace(/''/g, "'").replace(/\\\\/g, "\\").replace(/\\n/g, "\n");
  }
  return v;
}

type Row = { platform: string; orderDate: string; productName: string; brand: string; quantity: number; subtotal: number; shop: string };

const rows: Row[] = [];
let bad = 0;
for (const line of lines) {
  const m = line.match(/VALUES \((.*)\);\s*$/);
  if (!m) { bad++; continue; }
  const vals = splitValues(m[1]);
  if (vals.length !== 11) { bad++; continue; }
  // (id, platform, orderDate, productName, brand, unitPrice, quantity, subtotal, sourceFile, createdAt, shop)
  // Brand is recomputed from the product name: the dump's stored brands were
  // extracted with substring matching ("JUNIOR" → Uni) before the word-boundary fix.
  const productName = unquote(vals[3]);
  rows.push({
    platform: unquote(vals[1]),
    orderDate: unquote(vals[2]),
    productName,
    brand: canonicalizeBrand(extractBrand(productName)),
    quantity: parseInt(vals[6], 10) || 0,
    subtotal: parseFloat(unquote(vals[7])) || 0,
    shop: unquote(vals[10]),
  });
}

console.error(`parsed=${rows.length} bad=${bad}`);
const totalSales = rows.reduce((s, r) => s + r.subtotal, 0);
const totalQty = rows.reduce((s, r) => s + r.quantity, 0);
console.error(`totalSales=${totalSales.toFixed(2)} totalQty=${totalQty} dateRange=${rows.reduce((a, r) => r.orderDate < a ? r.orderDate : a, "9999")}..${rows.reduce((a, r) => r.orderDate > a ? r.orderDate : a, "0000")}`);

// --- Aggregate 1: month × shop × platform × brand ---
const aggMap = new Map<string, { sales: number; qty: number; lines: number }>();
for (const r of rows) {
  const month = r.orderDate.slice(0, 7);
  const key = `${month}|${r.shop}|${r.platform}|${r.brand}`;
  const e = aggMap.get(key) || { sales: 0, qty: 0, lines: 0 };
  e.sales += r.subtotal; e.qty += r.quantity; e.lines += 1;
  aggMap.set(key, e);
}

// --- Aggregate 2: product (shortened) × brand × shop × platform × month ---
const prodMap = new Map<string, { qty: number; sales: number }>();
for (const r of rows) {
  const display = shortenProductName(r.productName, r.brand);
  const month = r.orderDate.slice(0, 7);
  const key = `${display}|${r.brand}|${r.shop}|${r.platform}|${month}`;
  const e = prodMap.get(key) || { qty: 0, sales: 0 };
  e.qty += r.quantity; e.sales += r.subtotal;
  prodMap.set(key, e);
}
console.error(`aggEntries=${aggMap.size} prodEntries=${prodMap.size} distinctProducts=${new Set(rows.map(r => shortenProductName(r.productName, r.brand))).size}`);

// Compact serialization: dictionaries + arrays
const shops = Array.from(new Set(rows.map(r => r.shop))).sort();
const platforms = Array.from(new Set(rows.map(r => r.platform))).sort();
const brands = Array.from(new Set(rows.map(r => r.brand))).sort();
const months = Array.from(new Set(rows.map(r => r.orderDate.slice(0, 7)))).sort();
// Reconstruct names the same way the prod mapping does — names may contain "|"
const keyName = (k: string) => {
  const parts = k.split("|");
  return parts.slice(0, parts.length - 4).join("|");
};
const productNames = Array.from(new Set(Array.from(prodMap.keys()).map(keyName))).sort();

const agg = Array.from(aggMap.entries()).map(([k, v]) => {
  const [month, shop, platform, brand] = k.split("|");
  return [months.indexOf(month), shops.indexOf(shop), platforms.indexOf(platform), brands.indexOf(brand),
    Math.round(v.sales * 100) / 100, v.qty, v.lines];
});

const prod = Array.from(prodMap.entries()).map(([k, v]) => {
  const parts = k.split("|");
  const month = parts[parts.length - 1], platform = parts[parts.length - 2], shop = parts[parts.length - 3], brand = parts[parts.length - 4];
  const name = parts.slice(0, parts.length - 4).join("|");
  return [productNames.indexOf(name), brands.indexOf(brand), shops.indexOf(shop), platforms.indexOf(platform), months.indexOf(month),
    v.qty, Math.round(v.sales * 100) / 100];
});

const lastDate = rows.reduce((a, r) => r.orderDate > a ? r.orderDate : a, "0000");
const out = { generatedAt: new Date().toISOString().slice(0, 10), lastDate, months, shops, platforms, brands, products: productNames, agg, prod };
fs.writeFileSync("artifact/dashboard-data.json", JSON.stringify(out));
console.error(`json bytes=${fs.statSync("artifact/dashboard-data.json").size}`);
