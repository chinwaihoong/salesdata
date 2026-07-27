import { createHash } from "crypto";
import * as db from "./db";

export type ParsedOrder = {
  platform: "Shopee" | "Lazada";
  shop: string;
  orderDate: string; // YYYY-MM-DD
  orderId: string | null;
  productName: string;
  brand: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
  sourceFile: string;
};

export type ParseResult = {
  platform: "Shopee" | "Lazada";
  orders: ParsedOrder[];
  minDate: string;
  maxDate: string;
};

export type ImportResult = {
  ordersImported: number;
  duplicatesSkipped: number;
  platform: "Shopee" | "Lazada";
  minDate: string;
  maxDate: string;
};

/** Thrown when the file's date range overlaps rows that predate order-ID tracking. */
export class OverlapError extends Error {
  overlap = true as const;
}

export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function extractBrand(productName: string): string {
  if (!productName) return "Other";
  const KNOWN_BRANDS = [
    "Uni", "Zebra", "Pentel", "Staedtler", "Rotring", "Platinum",
    "DOD", "Iwatani", "Olight", "Kokuyo", "Pilot", "Lihit Lab",
    "Tombow", "Sakura", "Kuretake", "Mitsubishi",
  ];
  const upper = productName.toUpperCase();
  if (upper.includes("LIHIT LAB") || upper.includes("LIHITLAB") || upper.includes("LIHIT")) return "Lihit Lab";
  for (const brand of KNOWN_BRANDS) {
    if (brand === "Lihit Lab") continue;
    // Word-boundary match: a bare substring check tags e.g. "JUNIOR" as Uni
    if (new RegExp(`\\b${brand.toUpperCase()}\\b`).test(upper)) {
      if (brand === "Mitsubishi") return "Uni";
      return brand;
    }
  }
  if (upper.includes("UNI-BALL") || upper.includes("UNIBALL")) return "Uni";
  return "Other";
}

const SHOPEE_REQUIRED = ["Order Status", "Order Creation Date", "Product Name", "Deal Price", "Quantity", "Product Subtotal"];
const SHOPEE_ORDER_ID_HEADERS = ["Order ID", "Order SN", "Order No.", "Order Number"];
const LAZADA_REQUIRED = ["createTime", "itemName", "paidPrice", "status"];
const LAZADA_ORDER_ID_HEADERS = ["orderNumber", "orderNo", "orderId", "Order Number"];
const LAZADA_QUANTITY_HEADERS = ["quantity", "qty", "Quantity"];

function headerIndex(header: any[], candidates: string[]): number {
  for (const name of candidates) {
    const idx = header.findIndex(h => String(h ?? "").trim().toLowerCase() === name.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

/** Convert a cell to YYYY-MM-DD. Handles ISO-ish strings, "13 Jan 2025" style, and Excel date serials. */
function cellToDate(value: any): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && value > 20000 && value < 80000) {
    // Excel date serial (days since 1899-12-30); 25569 = days to Unix epoch
    const d = new Date(Math.round((value - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const str = String(value).trim();
  const isoMatch = str.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  const parts = str.split(" ");
  if (parts.length >= 3) {
    const months: Record<string, string> = {
      jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
      jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    };
    const day = parts[0].padStart(2, "0");
    const month = months[parts[1]?.toLowerCase()];
    const year = parts[2];
    if (month && /^\d{4}$/.test(year)) return `${year}-${month}-${day}`;
  }
  return "";
}

type SheetHit = { sheetName: string; rows: any[][]; header: any[] };

function findSheet(workbook: any, XLSX: any, matches: (header: any[]) => boolean): SheetHit | null {
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    if (rows.length < 1 || !Array.isArray(rows[0])) continue;
    if (matches(rows[0])) return { sheetName, rows, header: rows[0] };
  }
  return null;
}

/**
 * Parse a Shopee or Lazada Excel export into structured orders.
 * Detects the format from sheet headers (not the filename), so renamed
 * files and future export layout tweaks fail loudly instead of silently.
 */
export async function parseExcelOrders(fileBuffer: Buffer, fileName: string, shop: string): Promise<ParseResult> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(fileBuffer, { type: "buffer" });

  const shopeeHit = findSheet(workbook, XLSX, header =>
    headerIndex(header, ["Order Status"]) !== -1 && headerIndex(header, ["Product Name"]) !== -1
  );
  const lazadaHit = shopeeHit ? null : findSheet(workbook, XLSX, header =>
    headerIndex(header, ["itemName"]) !== -1 && headerIndex(header, ["paidPrice"]) !== -1
  );

  if (!shopeeHit && !lazadaHit) {
    const firstSheet = workbook.SheetNames[0];
    const rows = firstSheet ? XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { header: 1 }) as any[][] : [];
    const found = (rows[0] || []).map((h: any) => String(h ?? "").trim()).filter(Boolean).slice(0, 15);
    throw new Error(
      `Unrecognized file format. Expected Shopee headers (${SHOPEE_REQUIRED.slice(0, 3).join(", ")}, ...) ` +
      `or Lazada headers (${LAZADA_REQUIRED.join(", ")}). ` +
      (found.length ? `Found headers: ${found.join(", ")}` : "The first sheet appears to be empty.")
    );
  }

  const orders: ParsedOrder[] = shopeeHit
    ? parseShopeeRows(shopeeHit, fileName, shop)
    : parseLazadaRows(lazadaHit!, fileName, shop);

  if (orders.length === 0) {
    throw new Error("No valid orders found in the file (only Completed/confirmed orders with a product name and price are imported)");
  }

  const dates = orders.map(o => o.orderDate).sort();
  return {
    platform: shopeeHit ? "Shopee" : "Lazada",
    orders,
    minDate: dates[0],
    maxDate: dates[dates.length - 1],
  };
}

function requireHeaders(header: any[], required: string[], format: string): void {
  const missing = required.filter(name => headerIndex(header, [name]) === -1);
  if (missing.length > 0) {
    throw new Error(`${format} file is missing required column(s): ${missing.join(", ")}`);
  }
}

function parseShopeeRows(hit: SheetHit, fileName: string, shop: string): ParsedOrder[] {
  const { header, rows } = hit;
  requireHeaders(header, SHOPEE_REQUIRED, "Shopee");

  const statusIdx = headerIndex(header, ["Order Status"]);
  const dateIdx = headerIndex(header, ["Order Creation Date"]);
  const productIdx = headerIndex(header, ["Product Name"]);
  const dealPriceIdx = headerIndex(header, ["Deal Price"]);
  const quantityIdx = headerIndex(header, ["Quantity"]);
  const subtotalIdx = headerIndex(header, ["Product Subtotal"]);
  const orderIdIdx = headerIndex(header, SHOPEE_ORDER_ID_HEADERS);

  const orders: ParsedOrder[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[statusIdx]) continue;
    if (String(row[statusIdx]).trim() !== "Completed") continue;

    const orderDate = cellToDate(row[dateIdx]);
    if (!orderDate) continue;

    const productName = String(row[productIdx] || "").trim();
    const unitPrice = parseFloat(row[dealPriceIdx]) || 0;
    const quantity = parseInt(row[quantityIdx], 10) || 1;
    const subtotal = parseFloat(row[subtotalIdx]) || 0;
    const orderId = orderIdIdx !== -1 ? String(row[orderIdIdx] || "").trim() || null : null;

    if (productName && unitPrice > 0) {
      orders.push({
        platform: "Shopee", shop, orderDate, orderId, productName,
        brand: extractBrand(productName), unitPrice, quantity, subtotal, sourceFile: fileName,
      });
    }
  }
  return orders;
}

function parseLazadaRows(hit: SheetHit, fileName: string, shop: string): ParsedOrder[] {
  const { header, rows } = hit;
  requireHeaders(header, LAZADA_REQUIRED, "Lazada");

  const createTimeIdx = headerIndex(header, ["createTime"]);
  const itemNameIdx = headerIndex(header, ["itemName"]);
  const paidPriceIdx = headerIndex(header, ["paidPrice"]);
  const statusIdx = headerIndex(header, ["status"]);
  const quantityIdx = headerIndex(header, LAZADA_QUANTITY_HEADERS);
  const orderIdIdx = headerIndex(header, LAZADA_ORDER_ID_HEADERS);

  const orders: ParsedOrder[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (String(row[statusIdx] || "").trim().toLowerCase() !== "confirmed") continue;

    const orderDate = cellToDate(row[createTimeIdx]);
    if (!orderDate) continue;

    const itemName = String(row[itemNameIdx] || "").trim();
    // paidPrice is the row's paid amount; in the compiled file each row is one unit
    // unless an explicit quantity column says otherwise.
    const paidPrice = parseFloat(row[paidPriceIdx]) || 0;
    const quantity = quantityIdx !== -1 ? parseInt(row[quantityIdx], 10) || 1 : 1;
    const orderId = orderIdIdx !== -1 ? String(row[orderIdIdx] || "").trim() || null : null;

    if (itemName && paidPrice > 0) {
      orders.push({
        platform: "Lazada", shop, orderDate, orderId, productName: itemName,
        brand: extractBrand(itemName),
        unitPrice: Math.round((paidPrice / quantity) * 100) / 100,
        quantity,
        subtotal: paidPrice,
        sourceFile: fileName,
      });
    }
  }
  return orders;
}

/**
 * Parse and import an Excel file with duplicate protection:
 * - rows whose (orderId, productName) already exist for the shop/platform are skipped;
 * - if the file's date range overlaps rows imported before order IDs were tracked,
 *   the import is blocked with an OverlapError unless allowOverlap is set.
 */
export async function importExcelData(
  fileBuffer: Buffer,
  fileName: string,
  shop: string,
  options: { allowOverlap?: boolean } = {}
): Promise<ImportResult> {
  const { platform, orders, minDate, maxDate } = await parseExcelOrders(fileBuffer, fileName, shop);

  const existingKeys = await db.getExistingOrderKeys(platform, shop, minDate, maxDate);
  const keySet = new Set(existingKeys.map(k => `${k.orderId}::${k.productName}`));
  const toInsert = orders.filter(o => !o.orderId || !keySet.has(`${o.orderId}::${o.productName}`));
  const duplicatesSkipped = orders.length - toInsert.length;

  if (!options.allowOverlap) {
    const legacyCount = await db.countLegacyRowsInRange(platform, shop, minDate, maxDate, fileName);
    if (legacyCount > 0) {
      throw new OverlapError(
        `${legacyCount.toLocaleString()} existing ${platform} row(s) for ${shop} between ${minDate} and ${maxDate} ` +
        `were imported before order IDs were tracked, so duplicates cannot be detected automatically. ` +
        `Re-importing this range may double-count sales. Choose "Import Anyway" if you are sure this data is new.`
      );
    }
  }

  if (toInsert.length === 0) {
    return { ordersImported: 0, duplicatesSkipped, platform, minDate, maxDate };
  }

  await db.insertSalesOrders(toInsert);
  return { ordersImported: toInsert.length, duplicatesSkipped, platform, minDate, maxDate };
}
