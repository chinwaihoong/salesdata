/**
 * Per-SKU sales summary for merging with warehouse inventory on commodity code.
 *
 * Reads the RAW platform exports (not the dashboard database, which never
 * imported the SKU columns) and aggregates by barcode:
 *   Shopee  -> "SKU Reference No."   (13-digit EAN/JAN)
 *   Lazada  -> "sellerSku"           (same barcodes)
 *
 * Revenue definition matches the existing ABC summary exactly, so the totals
 * reconcile: Shopee = "Product Subtotal", Lazada = "paidPrice", counting only
 * Completed (Shopee) / confirmed (Lazada) rows.
 */
import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";

const RAW = process.env.RAW_DIR!;
const OUT = process.env.OUT_DIR!;
const FROM = "2025-07-01", TO = "2026-06-30";

type Line = {
  sku: string; product: string; variant: string; shop: string; platform: string;
  units: number; revenue: number; unitPrice: number; orderId: string; date: string;
};

const headerIndex = (hdr: any[], names: string[]) => {
  for (const n of names) {
    const i = hdr.findIndex(h => String(h ?? "").trim().toLowerCase() === n.toLowerCase());
    if (i !== -1) return i;
  }
  return -1;
};

function cellDate(v: any): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" && v > 20000 && v < 80000)
    return new Date(Math.round((v - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = s.match(/(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const p = s.split(" ");
  if (p.length >= 3) {
    const mo: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
      jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
    const d = p[0].padStart(2, "0"), mm = mo[p[1]?.toLowerCase()], y = p[2];
    if (mm && /^\d{4}$/.test(y)) return `${y}-${mm}-${d}`;
  }
  return "";
}

const lines: Line[] = [];
const skipped = { notCompleted: 0, outOfWindow: 0, noSku: 0, badRow: 0 };

function readShopee(file: string, shop: string) {
  const wb = XLSX.read(fs.readFileSync(file), { type: "buffer" });
  const sheet = wb.SheetNames.find(n => {
    const r = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1 }) as any[][];
    return r.length && headerIndex(r[0], ["Order Status"]) !== -1;
  });
  if (!sheet) throw new Error(`no Shopee sheet in ${file}`);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1 }) as any[][];
  const h = rows[0];
  const iId = headerIndex(h, ["Order ID"]), iStatus = headerIndex(h, ["Order Status"]),
    iDate = headerIndex(h, ["Order Creation Date"]), iName = headerIndex(h, ["Product Name"]),
    iSku = headerIndex(h, ["SKU Reference No."]), iVar = headerIndex(h, ["Variation Name"]),
    iPrice = headerIndex(h, ["Deal Price"]), iQty = headerIndex(h, ["Quantity"]),
    iSub = headerIndex(h, ["Product Subtotal"]);
  for (const c of [iId, iStatus, iDate, iName, iSku, iPrice, iQty, iSub])
    if (c === -1) throw new Error(`missing column in ${file}`);

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row[iStatus]) { skipped.badRow++; continue; }
    if (String(row[iStatus]).trim() !== "Completed") { skipped.notCompleted++; continue; }
    const date = cellDate(row[iDate]);
    if (!date) { skipped.badRow++; continue; }
    if (date < FROM || date > TO) { skipped.outOfWindow++; continue; }
    const units = parseInt(row[iQty], 10) || 0;
    const revenue = parseFloat(row[iSub]) || 0;
    const sku = String(row[iSku] ?? "").trim();
    if (!sku) skipped.noSku++;
    lines.push({
      sku: sku || "(no SKU)",
      product: String(row[iName] ?? "").trim(),
      variant: iVar === -1 ? "" : String(row[iVar] ?? "").trim(),
      shop, platform: "Shopee", units, revenue,
      unitPrice: parseFloat(row[iPrice]) || (units ? revenue / units : 0),
      orderId: String(row[iId] ?? "").trim(), date,
    });
  }
}

function readLazada(file: string, shop: string) {
  const wb = XLSX.read(fs.readFileSync(file), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as any[][];
  const h = rows[0];
  const iSku = headerIndex(h, ["sellerSku"]), iName = headerIndex(h, ["itemName"]),
    iVar = headerIndex(h, ["variation"]), iPaid = headerIndex(h, ["paidPrice"]),
    iStatus = headerIndex(h, ["status"]), iDate = headerIndex(h, ["createTime"]),
    iOrder = headerIndex(h, ["orderNumber", "orderId"]);
  for (const c of [iSku, iName, iPaid, iStatus, iDate])
    if (c === -1) throw new Error(`missing column in ${file}`);

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) { skipped.badRow++; continue; }
    if (String(row[iStatus] ?? "").trim().toLowerCase() !== "confirmed") { skipped.notCompleted++; continue; }
    const date = cellDate(row[iDate]);
    if (!date) { skipped.badRow++; continue; }
    if (date < FROM || date > TO) { skipped.outOfWindow++; continue; }
    // One Lazada line == one unit, matching the existing import and ABC summary
    const revenue = parseFloat(row[iPaid]) || 0;
    const sku = String(row[iSku] ?? "").trim();
    if (!sku) skipped.noSku++;
    lines.push({
      sku: sku || "(no SKU)",
      product: String(row[iName] ?? "").trim(),
      variant: iVar === -1 ? "" : String(row[iVar] ?? "").trim().replace(/^type:/, ""),
      shop, platform: "Lazada", units: 1, revenue, unitPrice: revenue,
      orderId: iOrder === -1 ? "" : String(row[iOrder] ?? "").trim(), date,
    });
  }
}

for (const f of fs.readdirSync(RAW).sort()) {
  const p = path.join(RAW, f);
  if (f.startsWith("JS_2")) readShopee(p, "Japan Stationery");
  else if (f.startsWith("EC_2")) readShopee(p, "Elite Camp");
  else if (f.startsWith("LAZ_JS")) readLazada(p, "Japan Stationery");
  else if (f.startsWith("LAZ_EC")) readLazada(p, "Elite Camp");
}

// ---- aggregate per SKU x shop x platform ----
type Agg = {
  sku: string; shop: string; platform: string; products: Set<string>; variants: Set<string>;
  units: number; revenue: number; orders: Set<string>; min: number; max: number;
  first: string; last: string;
};
const map = new Map<string, Agg>();
for (const l of lines) {
  const key = `${l.sku}||${l.shop}||${l.platform}`;
  let a = map.get(key);
  if (!a) {
    a = { sku: l.sku, shop: l.shop, platform: l.platform, products: new Set(), variants: new Set(),
      units: 0, revenue: 0, orders: new Set(), min: Infinity, max: -Infinity, first: l.date, last: l.date };
    map.set(key, a);
  }
  a.products.add(l.product);
  if (l.variant) a.variants.add(l.variant);
  a.units += l.units;
  a.revenue += l.revenue;
  if (l.orderId) a.orders.add(l.orderId);
  if (l.unitPrice > 0) { a.min = Math.min(a.min, l.unitPrice); a.max = Math.max(a.max, l.unitPrice); }
  if (l.date < a.first) a.first = l.date;
  if (l.date > a.last) a.last = l.date;
}

const rows = [...map.values()].sort((a, b) => b.revenue - a.revenue);
const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
const head = ["SKU / Barcode", "Product Name", "Variant / Option", "Shop", "Platform",
  "Units Sold", "Revenue (RM)", "Avg Selling Price (RM)", "Min Unit Price (RM)",
  "Max Unit Price (RM)", "Distinct Orders", "First Sale", "Last Sale", "Name Variants Merged"];
const csv = [head.join(",")];
for (const a of rows) {
  csv.push([
    esc(a.sku), esc([...a.products][0] ?? ""), esc([...a.variants].join(" | ")),
    esc(a.shop), esc(a.platform), a.units, a.revenue.toFixed(2),
    (a.units ? a.revenue / a.units : 0).toFixed(2),
    (a.min === Infinity ? 0 : a.min).toFixed(2), (a.max === -Infinity ? 0 : a.max).toFixed(2),
    a.orders.size, a.first, a.last, a.products.size,
  ].join(","));
}
fs.writeFileSync(path.join(OUT, "sku-sales-summary-12m.csv"), csv.join("\n") + "\n");

const totUnits = rows.reduce((s, a) => s + a.units, 0);
const totRev = rows.reduce((s, a) => s + a.revenue, 0);
const noSkuRows = rows.filter(a => a.sku === "(no SKU)");

// Excel twin: sheet 1 stays join-ready (one row per SKU, no total row mixed in),
// sheet 2 carries the single-line reconciliation figure.
const wb = XLSX.utils.book_new();
const aoa: any[][] = [head, ...rows.map(a => [
  a.sku, [...a.products][0] ?? "", [...a.variants].join(" | "), a.shop, a.platform,
  a.units, +a.revenue.toFixed(2), +(a.units ? a.revenue / a.units : 0).toFixed(2),
  +(a.min === Infinity ? 0 : a.min).toFixed(2), +(a.max === -Infinity ? 0 : a.max).toFixed(2),
  a.orders.size, a.first, a.last, a.products.size,
])];
const ws = XLSX.utils.aoa_to_sheet(aoa);
ws["!cols"] = [{ wch: 16 }, { wch: 46 }, { wch: 26 }, { wch: 17 }, { wch: 9 },
  { wch: 10 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 14 },
  { wch: 11 }, { wch: 11 }, { wch: 12 }];
ws["!freeze"] = { xSplit: 0, ySplit: 1 };
XLSX.utils.book_append_sheet(wb, ws, "SKU Summary");

const totSheet = XLSX.utils.aoa_to_sheet([
  ["Metric", "Value"],
  ["Window (order date)", `${FROM} to ${TO}`],
  ["Status included", "Shopee = Completed, Lazada = confirmed"],
  ["SKU rows", rows.length],
  ["Distinct SKUs / barcodes", new Set(rows.map(r => r.sku)).size],
  ["Total units sold", totUnits],
  ["TOTAL REVENUE (RM)", +totRev.toFixed(2)],
  [],
  ["Segment", "Revenue (RM)"],
  ...["Japan Stationery", "Elite Camp"].flatMap(shop => ["Shopee", "Lazada"].map(pl =>
    [`${shop} — ${pl}`, +rows.filter(r => r.shop === shop && r.platform === pl)
      .reduce((s, a) => s + a.revenue, 0).toFixed(2)])),
]);
totSheet["!cols"] = [{ wch: 34 }, { wch: 40 }];
XLSX.utils.book_append_sheet(wb, totSheet, "Total");
XLSX.writeFile(wb, path.join(OUT, "sku-sales-summary-12m.xlsx"));
console.log(JSON.stringify({
  window: [FROM, TO],
  sourceLines: lines.length,
  skuRows: rows.length,
  totalUnits: totUnits,
  totalRevenue: +totRev.toFixed(2),
  distinctSkus: new Set(rows.map(r => r.sku)).size,
  rowsWithoutSku: noSkuRows.length,
  revenueWithoutSku: +noSkuRows.reduce((s, a) => s + a.revenue, 0).toFixed(2),
  bySegment: ["Japan Stationery", "Elite Camp"].flatMap(shop =>
    ["Shopee", "Lazada"].map(pl => {
      const seg = rows.filter(r => r.shop === shop && r.platform === pl);
      return { shop, platform: pl, rows: seg.length,
        revenue: +seg.reduce((s, a) => s + a.revenue, 0).toFixed(2),
        units: seg.reduce((s, a) => s + a.units, 0) };
    })),
  skipped,
}, null, 2));
