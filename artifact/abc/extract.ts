import * as fs from "fs";
import { canonicalizeBrand, shortenProductName } from "../../server/db";
import { extractBrand } from "../../server/importer";

function splitValues(body: string): string[] {
  const out: string[] = []; let cur = ""; let inStr = false; let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (c === "\\") { cur += c + (body[i+1] ?? ""); i++; continue; }
      if (c === "'") { if (body[i+1] === "'") { cur += "''"; i++; continue; } inStr = false; }
      cur += c; continue;
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
const unq = (v: string) => v.startsWith("'") && v.endsWith("'")
  ? v.slice(1, -1).replace(/\\'/g, "'").replace(/''/g, "'").replace(/\\\\/g, "\\") : v;

type R = { shop: string; platform: string; month: string; date: string; raw: string; name: string; brand: string; qty: number; sub: number };
const rows: R[] = [];
for (const l of fs.readFileSync("/home/user/salesdata/data/database-dump.sql", "utf-8").split("\n")) {
  if (!l.startsWith("INSERT INTO sales_orders")) continue;
  const m = l.match(/VALUES \((.*)\);\s*$/); if (!m) continue;
  const v = splitValues(m[1]); if (v.length !== 11) continue;
  const raw = unq(v[3]);
  const brand = canonicalizeBrand(extractBrand(raw));
  const date = unq(v[2]);
  rows.push({ shop: unq(v[10]), platform: unq(v[1]), month: date.slice(0, 7), date, raw,
    name: shortenProductName(raw, brand), brand, qty: +v[6], sub: parseFloat(unq(v[7])) });
}

// Complete months only: drop a trailing month that is still in progress
const maxDate = rows.reduce((a, r) => (r.date > a ? r.date : a), "0000");
const partial = Number(maxDate.slice(8)) < 28 ? maxDate.slice(0, 7) : null;
const complete = rows.filter(r => r.month !== partial);
const months = [...new Set(complete.map(r => r.month))].sort();
const last12 = months.slice(-12);
const win = new Set(last12);

function aggregate(src: R[]) {
  const map = new Map<string, any>();
  for (const r of src) {
    const key = `${r.shop}||${r.name}`;
    let e = map.get(key);
    if (!e) {
      e = { shop: r.shop, name: r.name, brand: r.brand, units: 0, revenue: 0, lines: 0,
            shopee: 0, lazada: 0, months: new Set<string>(), raws: new Set<string>(),
            first: r.date, last: r.date };
      map.set(key, e);
    }
    e.units += r.qty; e.revenue += r.sub; e.lines++;
    if (r.platform === "Shopee") e.shopee += r.sub; else e.lazada += r.sub;
    e.months.add(r.month); e.raws.add(r.raw);
    if (r.date < e.first) e.first = r.date;
    if (r.date > e.last) e.last = r.date;
  }
  return [...map.values()]
    .map(e => ({ ...e, monthsActive: e.months.size, variants: e.raws.size, months: undefined, raws: undefined }))
    .sort((a, b) => b.revenue - a.revenue);
}

const w12 = complete.filter(r => win.has(r.month));
const out = {
  meta: {
    generated: new Date().toISOString().slice(0, 10),
    allMonths: [months[0], months[months.length - 1]],
    window12: [last12[0], last12[last12.length - 1]],
    partialExcluded: partial,
    rowsAll: complete.length, rows12: w12.length,
  },
  months12: last12,
  a12: aggregate(w12),
  aAll: aggregate(complete),
  monthly: (() => {
    const map = new Map<string, any>();
    for (const r of w12) {
      const key = `${r.shop}||${r.name}`;
      let e = map.get(key);
      if (!e) { e = { shop: r.shop, name: r.name, brand: r.brand, u: {} as Record<string, number> }; map.set(key, e); }
      e.u[r.month] = (e.u[r.month] || 0) + r.qty;
    }
    return [...map.values()];
  })(),
};
fs.writeFileSync("./artifact/abc/abc-data.json", JSON.stringify(out));
console.log(`window12 = ${out.meta.window12.join(" .. ")}  (partial excluded: ${partial})`);
console.log(`products last 12m = ${out.a12.length}   all time = ${out.aAll.length}`);
for (const shop of ["Japan Stationery", "Elite Camp"]) {
  const s = out.a12.filter((x: any) => x.shop === shop);
  console.log(`  ${shop}: ${s.length} products, RM ${s.reduce((t: number, x: any) => t + x.revenue, 0).toFixed(2)} in last 12m`);
}
