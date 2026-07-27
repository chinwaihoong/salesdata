import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, InsertSalesOrder, users, uploadedFiles, salesOrders } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ============ Brand & Product Name Helpers ============

export function canonicalizeBrand(brand: string): string {
  if (!brand) return 'Other';
  const upper = brand.toUpperCase().trim();
  // Unify Mitsubishi / Uni / Uniball under "Uni"
  if (upper === 'MITSUBISHI' || upper === 'MITSU') return 'Uni';
  if (upper === 'UNI' || upper === 'UNI-BALL' || upper === 'UNIBALL') return 'Uni';
  return brand;
}

export function shortenProductName(name: string, brand?: string): string {
  if (!name || typeof name !== 'string') return 'Other';
  let n = name.trim();
  const upper = n.toUpperCase();
  const effectiveBrand = brand || detectBrandFromName(name);

  // === Step 1: Brand alias normalization ===
  // Normalize brand names in the text before any processing
  const aliasReplacements: [RegExp, string][] = [
    [/\buniball\b/gi, 'Uni'],
    [/\buni-ball\b/gi, 'Uni'],
    [/\bmitsubishi\b/gi, 'Uni'],
    [/\bmitsu\b/gi, 'Uni'],
  ];
  for (const [re, canonical] of aliasReplacements) {
    if (re.test(n)) {
      n = n.replace(re, canonical);
    }
  }

  // === Step 2: Remove SEO filler prefixes ===
  const prefixFillers = [
    /^Japan\s+Version\s+/i,
    /^Original\s+Japan\s+/i,
    /^Original\s+/i,
    /^Auto\s+Lead\s+Rotation\s+/i,
    /^Japan\s+/i,
  ];
  for (const re of prefixFillers) {
    if (re.test(n)) {
      n = n.replace(re, '').trim();
      break;
    }
  }

  // === Step 3: Handle refill/replacement items specially ===
  // Extract key info BEFORE stripping filler words
  if (/refill|replacement/i.test(n)) {
    // Extract model codes like SXR-80-05, SXR-200-07, TA-DM400-08N, UL-S-0.3-25, M20-700, UBRZ38
    // Priority: full code with dash, then partial code
    let modelCode = '';
    const fullCodeMatch = n.match(/\b((?:SXR|TA-|UL|HU|UBRZ|M\d+|IRF|HRFG|HRG|SXN|D\d+|ULN)[A-Z0-9]*-[A-Z0-9]+(?:-[A-Z0-9]+)*)\b/i);
    if (fullCodeMatch) {
      modelCode = fullCodeMatch[1];
    } else {
      // Try broader pattern for codes like 1P, HRFG-03-H
      const altCodeMatch = n.match(/\b((?:SXR|TA-|UL|HU|UBRZ|M\d+|IRF|HRFG|HRG|SXN|D\d+|ULN)[A-Z0-9]*-[A-Z0-9]+)\b/i);
      if (altCodeMatch) {
        modelCode = altCodeMatch[1];
      }
    }

    // Extract product identifier (e.g., "Jetstream", "Airpress", "Dotliner", "Hi-Uni", "ZENTO", "Iroshizuku", "Neox")
    const productKeywords = [
      'Jetstream', 'Airpress', 'Dotliner', 'Gloo', 'Hi-Uni', 'ZENTO',
      'Iroshizuku', 'Neox', 'Field Architectural', 'Kuru Toga', 'Graph Gear',
      'Mildliner', 'Ain', 'Ballpoint', 'Gel Pen', 'Fountain Pen',
      'Mechanical Pencil', 'Glue Tape', 'Ink Cartridge', 'Lead Refill',
      'Replacement Lead', 'Pressurized', 'G2', 'D1',
    ];
    let productName = '';
    for (const kw of productKeywords) {
      if (new RegExp(escapeRegex(kw), 'i').test(n)) {
        productName = kw;
        break;
      }
    }

    // Extract size info (e.g., "0.5mm", "2.0mm", "0.38mm")
    let sizeInfo = '';
    const sizeMatch = n.match(/\b(\d+\.\d+\s*mm)\b/i);
    if (sizeMatch && !sizeMatch[1].includes('0.5mm') && !sizeMatch[1].includes('0.7mm')) {
      // Only keep non-standard sizes
      sizeInfo = sizeMatch[1].trim();
    }

    // Build the display name: Brand + Product Name + Refill + Code + Size
    const parts: string[] = [effectiveBrand];
    if (productName) parts.push(productName);
    parts.push('Refill');
    if (modelCode) parts.push(modelCode);
    if (sizeInfo && !parts.some(p => p.includes(sizeInfo))) parts.push(sizeInfo);

    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  // === Step 4: Remove trailing filler suffixes ===
  // Remove trailing parenthetical specs like "(0.5mm)", "(0.5mm Set of 5)"
  n = n.replace(/\s*\(\d+\.?\d*(?:\/\d+\.?\d*)*(?:\s*mm)?\)$/g, '');
  n = n.replace(/\s*\(\d+\.?\d*(?:\/\d+\.?\d*)*(?:\s*mm)?\s+Set\s+of\s+\d+\)$/gi, '');
  // Remove parenthetical like "(refill or tape set)" at end
  n = n.replace(/\s*\([^)]*refill[^)]*\)$/gi, '');

  // === Step 5: Remove long trailing lists of sizes/model numbers ===
  // Remove sequences of 3+ size specifiers
  n = n.replace(/\s+(?:\d+\.?\d*\s*mm|\d+\.?\d*mm|\d+\.?\d*\s+mm){2,}/gi, '');
  n = n.replace(/\s+(?:[A-Z]{2,}\d{3,}\s*){3,}/gi, '');
  // Remove trailing model codes
  n = n.replace(/\s+[A-Z]{2,}\d{3,}(?:\s+[A-Z]{2,}\d{3,})*$/g, '');

  // Remove "Double Sided Highlighter Set - Pack of X Colors" -> keep "Highlighter Set Pack of X"
  n = n.replace(/\s*Double\s+Sided\s+/gi, '');
  n = n.replace(/\s+Drafting\s+Mech\s+Pencil/gi, ' Mechanical Pencil');

  // Remove remaining parenthetical specs
  n = n.replace(/\s*\([^)]*\d+\.?\d*\s*mm[^)]*\)$/g, '');
  n = n.replace(/\s*\([^)]*\)$/g, '');

  // === Step 6: Clean up and normalize ===
  n = n.replace(/\s+/g, ' ').trim();
  // Remove trailing "1P", "Set", etc.
  n = n.replace(/\s+1P$/i, '');

  // === Step 7: Fix duplicate brand name ===
  const escapedBrand = escapeRegex(effectiveBrand);
  // "Uni Uni Kuru Toga" -> "Uni Kuru Toga"
  const dupRegex = new RegExp(`^(${escapedBrand})\\s+${escapedBrand}\\s+`, 'i');
  n = n.replace(dupRegex, '$1 ');
  // Handle multi-word brand duplicates like "Lihit Lab Lihit Lab"
  const multiWordDup = new RegExp(`^(${escapedBrand}\\s+)${escapedBrand}\\s+`, 'i');
  n = n.replace(multiWordDup, '$1');

  // If name is now too short or empty, fall back to truncated original
  if (n.length < 3) {
    return name.trim().substring(0, 80);
  }

  // Cap at reasonable length
  if (n.length > 120) {
    n = n.substring(0, 120).replace(/\s+\S+$/, '');
  }

  return n;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectBrandFromName(name: string): string {
  const upper = name.toUpperCase();
  if (upper.includes('LIHIT LAB') || upper.includes('LIHITLAB') || upper.includes('LIHIT')) return 'Lihit Lab';
  const KNOWN_BRANDS = [
    'Uni', 'Zebra', 'Pentel', 'Staedtler', 'Rotring', 'Platinum',
    'DOD', 'Iwatani', 'Olight', 'Kokuyo', 'Pilot', 'Tombow', 'Sakura', 'Kuretake'
  ];
  for (const brand of KNOWN_BRANDS) {
    if (upper.includes(brand.toUpperCase())) return brand;
  }
  // Check Mitsubishi (canonicalize to Uni)
  if (upper.includes('MITSUBISHI')) return 'Uni';
  // Check Uni-Ball (canonicalize to Uni)
  if (upper.includes('UNI-BALL') || upper.includes('UNIBALL')) return 'Uni';
  return 'Other';
}

// ============ Sales Dashboard Queries ============

type DashboardFilters = {
  startDate?: string;
  endDate?: string;
  platform?: string;
  brand?: string;
  shop?: string;
};

function buildWhere(filters: DashboardFilters): { clause: string; params: any[] } {
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.startDate) {
    conditions.push('orderDate >= ?');
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    conditions.push('orderDate <= ?');
    params.push(filters.endDate);
  }
  if (filters.platform && filters.platform !== 'all') {
    conditions.push('platform = ?');
    params.push(filters.platform);
  }
  if (filters.brand && filters.brand !== 'all') {
    conditions.push('brand = ?');
    params.push(filters.brand);
  }
  if (filters.shop && filters.shop !== 'all') {
    conditions.push('shop = ?');
    params.push(filters.shop);
  }

  if (conditions.length === 0) {
    return { clause: '', params: [] };
  }
  return { clause: 'WHERE ' + conditions.join(' AND '), params };
}

async function rawExecute(query: string, params: any[] = []) {
  const db = await getDb();
  if (!db) return [];
  // @ts-ignore - using $client for raw SQL - it's a mysql2 pool (non-promise), use callback
  const pool = (db as any).$client;
  return new Promise<any[]>((resolve, reject) => {
    pool.execute(query, params, (err: any, results: any) => {
      if (err) return reject(err);
      resolve(results as any[]);
    });
  });
}

export async function getDashboardOverview(filters: DashboardFilters) {
  const { clause, params } = buildWhere(filters);

  const totals = await rawExecute(
    `SELECT 
      COUNT(*) as totalOrders,
      SUM(subtotal) as totalSales,
      SUM(quantity) as totalQuantity,
      COUNT(DISTINCT orderDate) as activeDays
     FROM sales_orders ${clause}`,
    params
  );

  const platformSales = await rawExecute(
    `SELECT platform, COUNT(*) as orders, SUM(subtotal) as sales, SUM(quantity) as quantity
     FROM sales_orders ${clause}
     GROUP BY platform ORDER BY sales DESC`,
    params
  );

  const brandSales = await rawExecute(
    `SELECT brand, COUNT(*) as orders, SUM(subtotal) as sales, SUM(quantity) as quantity
     FROM sales_orders ${clause}
     GROUP BY brand ORDER BY sales DESC`,
    params
  );

  const platforms = await rawExecute(
    'SELECT DISTINCT platform FROM sales_orders ORDER BY platform'
  );

  const brands = await rawExecute(
    'SELECT DISTINCT brand FROM sales_orders ORDER BY brand'
  );

  return {
    totalOrders: totals[0]?.totalOrders || 0,
    totalSales: parseFloat(totals[0]?.totalSales || 0),
    totalQuantity: totals[0]?.totalQuantity || 0,
    activeDays: totals[0]?.activeDays || 0,
    platformSales,
    brandSales,
    availablePlatforms: platforms.map((p: any) => p.platform),
    availableBrands: brands.map((b: any) => b.brand),
  };
}

export async function getSalesByDay(filters: DashboardFilters) {
  const { clause, params } = buildWhere(filters);

  // DATE_FORMAT keeps the output a YYYY-MM-DD string now that orderDate is a real DATE column
  return await rawExecute(
    `SELECT DATE_FORMAT(orderDate, '%Y-%m-%d') as date, SUM(subtotal) as sales, SUM(quantity) as quantity, COUNT(*) as orders
     FROM sales_orders ${clause}
     GROUP BY date ORDER BY date`,
    params
  );
}

export async function getSalesByWeek(filters: DashboardFilters) {
  const { clause, params } = buildWhere(filters);

  return await rawExecute(
    `SELECT
      CONCAT(DATE_FORMAT(orderDate, '%Y'), '-W', LPAD(WEEK(orderDate, 1), 2, '0')) as week,
      DATE_FORMAT(MIN(orderDate), '%Y-%m-%d') as date,
      SUM(subtotal) as sales,
      SUM(quantity) as quantity,
      COUNT(*) as orders
     FROM sales_orders ${clause}
     GROUP BY week
     ORDER BY MIN(orderDate)`,
    params
  );
}

export async function getSalesByMonth(filters: DashboardFilters) {
  const { clause, params } = buildWhere(filters);

  return await rawExecute(
    `SELECT 
      DATE_FORMAT(orderDate, '%Y-%m') as month,
      SUM(subtotal) as sales,
      SUM(quantity) as quantity,
      COUNT(*) as orders
     FROM sales_orders ${clause}
     GROUP BY month ORDER BY month`,
    params
  );
}

export async function getSalesByYear(filters: DashboardFilters) {
  const { clause, params } = buildWhere(filters);

  return await rawExecute(
    `SELECT 
      DATE_FORMAT(orderDate, '%Y') as year,
      SUM(subtotal) as sales,
      SUM(quantity) as quantity,
      COUNT(*) as orders
     FROM sales_orders ${clause}
     GROUP BY year ORDER BY year`,
    params
  );
}

export async function getTopItemsByQuantity(filters: DashboardFilters, limit: number = 50) {
  const { clause, params } = buildWhere(filters);

  const rows = await rawExecute(
    `SELECT productName, brand, SUM(quantity) as totalQty, SUM(subtotal) as totalSales, AVG(unitPrice) as avgPrice, COUNT(DISTINCT orderDate) as orderCount
     FROM sales_orders ${clause}
     GROUP BY productName, brand
     ORDER BY totalQty DESC
     LIMIT ${limit}`,
    params
  );

  return rows.map((row: any) => ({
    ...row,
    brand: canonicalizeBrand(row.brand),
    displayName: shortenProductName(row.productName, canonicalizeBrand(row.brand)),
  }));
}

export async function getTopItemsByValue(filters: DashboardFilters, limit: number = 50) {
  const { clause, params } = buildWhere(filters);

  const rows = await rawExecute(
    `SELECT productName, brand, SUM(quantity) as totalQty, SUM(subtotal) as totalSales, AVG(unitPrice) as avgPrice, COUNT(DISTINCT orderDate) as orderCount
     FROM sales_orders ${clause}
     GROUP BY productName, brand
     ORDER BY totalSales DESC
     LIMIT ${limit}`,
    params
  );

  return rows.map((row: any) => ({
    ...row,
    brand: canonicalizeBrand(row.brand),
    displayName: shortenProductName(row.productName, canonicalizeBrand(row.brand)),
  }));
}

export async function getPlatformComparison(filters: DashboardFilters) {
  const { clause, params } = buildWhere(filters);

  return await rawExecute(
    `SELECT 
      DATE_FORMAT(orderDate, '%Y-%m') as period,
      platform,
      SUM(subtotal) as sales,
      SUM(quantity) as quantity
     FROM sales_orders ${clause}
     GROUP BY period, platform
     ORDER BY period, platform`,
    params
  );
}

export async function getPlatformComparisonYearly(filters: DashboardFilters) {
  const { clause, params } = buildWhere(filters);

  return await rawExecute(
    `SELECT 
      DATE_FORMAT(orderDate, '%Y') as period,
      platform,
      SUM(subtotal) as sales,
      SUM(quantity) as quantity
     FROM sales_orders ${clause}
     GROUP BY period, platform
     ORDER BY period, platform`,
    params
  );
}

export async function getShopPlatformComparison(filters: DashboardFilters) {
  const { clause, params } = buildWhere(filters);

  return await rawExecute(
    `SELECT 
      DATE_FORMAT(orderDate, '%Y-%m') as period,
      shop,
      platform,
      SUM(subtotal) as sales,
      SUM(quantity) as quantity
     FROM sales_orders ${clause}
     GROUP BY period, shop, platform
     ORDER BY period, shop, platform`,
    params
  );
}

export async function getShopPlatformComparisonYearly(filters: DashboardFilters) {
  const { clause, params } = buildWhere(filters);

  return await rawExecute(
    `SELECT 
      DATE_FORMAT(orderDate, '%Y') as period,
      shop,
      platform,
      SUM(subtotal) as sales,
      SUM(quantity) as quantity
     FROM sales_orders ${clause}
     GROUP BY period, shop, platform
     ORDER BY period, shop, platform`,
    params
  );
}

export async function getBrandComparison(filters: DashboardFilters) {
  const { clause, params } = buildWhere(filters);

  const rows = await rawExecute(
    `SELECT brand, SUM(subtotal) as sales, SUM(quantity) as quantity, COUNT(*) as orders
     FROM sales_orders ${clause}
     GROUP BY brand
     ORDER BY sales DESC`,
    params
  );

  return rows.map((row: any) => ({
    ...row,
    brand: canonicalizeBrand(row.brand),
  }));
}

/** Previous calendar month of a YYYY-MM key, e.g. "2026-01" -> "2025-12". */
export function shiftMonth(month: string, deltaMonths: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + deltaMonths;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** Pure MoM/YoY computation over monthly aggregate rows (sorted by month ascending). */
export function computeMonthlyTrends(rows: { month: string; sales: any; quantity: any; lines: any }[]) {
  const salesByMonth = new Map<string, number>();
  for (const row of rows) salesByMonth.set(row.month, parseFloat(row.sales) || 0);

  const pctChange = (current: number, previous: number | undefined) => {
    if (previous === undefined || previous === 0) return null;
    return ((current - previous) / previous) * 100;
  };

  return rows.map(row => {
    const sales = parseFloat(row.sales) || 0;
    const prevMonthSales = salesByMonth.get(shiftMonth(row.month, -1));
    const prevYearSales = salesByMonth.get(shiftMonth(row.month, -12));
    return {
      month: row.month,
      sales,
      quantity: Number(row.quantity) || 0,
      lines: Number(row.lines) || 0,
      momPct: pctChange(sales, prevMonthSales),
      yoyPct: pctChange(sales, prevYearSales),
      prevYearSales: prevYearSales ?? null,
    };
  });
}

/**
 * Monthly sales with month-over-month and year-over-year change.
 * Date-range filters are intentionally ignored: the comparison always uses
 * the full history so previous months/years are available to compare against.
 */
export async function getMonthlyTrends(filters: DashboardFilters) {
  const { clause, params } = buildWhere({
    platform: filters.platform,
    brand: filters.brand,
    shop: filters.shop,
  });

  const rows = await rawExecute(
    `SELECT
      DATE_FORMAT(orderDate, '%Y-%m') as month,
      SUM(subtotal) as sales,
      SUM(quantity) as quantity,
      COUNT(*) as lines
     FROM sales_orders ${clause}
     GROUP BY month ORDER BY month`,
    params
  );

  return computeMonthlyTrends(rows);
}

/**
 * Order-level metrics computed from rows that carry a platform order ID.
 * Legacy rows imported before order-ID tracking are excluded; coveragePct
 * tells the caller how much of the filtered data the metrics are based on.
 */
export async function getOrderMetrics(filters: DashboardFilters) {
  const { clause, params } = buildWhere(filters);
  const trackedClause = clause
    ? `${clause} AND orderId IS NOT NULL`
    : "WHERE orderId IS NOT NULL";

  const tracked = await rawExecute(
    `SELECT
      COUNT(DISTINCT orderId) as uniqueOrders,
      SUM(subtotal) as trackedSales,
      SUM(quantity) as trackedQty,
      COUNT(*) as trackedLines
     FROM sales_orders ${trackedClause}`,
    params
  );

  const totals = await rawExecute(
    `SELECT COUNT(*) as totalLines FROM sales_orders ${clause}`,
    params
  );

  const uniqueOrders = Number(tracked[0]?.uniqueOrders) || 0;
  const trackedSales = parseFloat(tracked[0]?.trackedSales) || 0;
  const trackedQty = Number(tracked[0]?.trackedQty) || 0;
  const trackedLines = Number(tracked[0]?.trackedLines) || 0;
  const totalLines = Number(totals[0]?.totalLines) || 0;

  return {
    uniqueOrders,
    avgOrderValue: uniqueOrders > 0 ? trackedSales / uniqueOrders : null,
    avgItemsPerOrder: uniqueOrders > 0 ? trackedQty / uniqueOrders : null,
    avgLinesPerOrder: uniqueOrders > 0 ? trackedLines / uniqueOrders : null,
    coveragePct: totalLines > 0 ? (trackedLines / totalLines) * 100 : 0,
  };
}

/** Raw line items matching the filters, for the Excel export. */
export async function getOrdersForExport(filters: DashboardFilters) {
  const { clause, params } = buildWhere(filters);

  return await rawExecute(
    `SELECT
      DATE_FORMAT(orderDate, '%Y-%m-%d') as orderDate,
      platform, shop, brand, productName, orderId,
      quantity, unitPrice, subtotal, sourceFile
     FROM sales_orders ${clause}
     ORDER BY orderDate, platform, id`,
    params
  );
}

// ============ Import Duplicate Protection ============

/** (orderId, productName) pairs already stored for a shop/platform in a date range. */
export async function getExistingOrderKeys(platform: string, shop: string, minDate: string, maxDate: string) {
  return await rawExecute(
    `SELECT orderId, productName FROM sales_orders
     WHERE platform = ? AND shop = ? AND orderDate >= ? AND orderDate <= ? AND orderId IS NOT NULL`,
    [platform, shop, minDate, maxDate]
  ) as { orderId: string; productName: string }[];
}

/**
 * Rows in the date range imported without an order ID (from another file).
 * These cannot be deduplicated automatically, so re-importing over them risks double counting.
 */
export async function countLegacyRowsInRange(platform: string, shop: string, minDate: string, maxDate: string, excludeSourceFile: string) {
  const rows = await rawExecute(
    `SELECT COUNT(*) as cnt FROM sales_orders
     WHERE platform = ? AND shop = ? AND orderDate >= ? AND orderDate <= ?
       AND orderId IS NULL AND sourceFile != ?`,
    [platform, shop, minDate, maxDate, excludeSourceFile]
  );
  return Number(rows[0]?.cnt) || 0;
}

export async function insertSalesOrders(orders: {
  platform: "Shopee" | "Lazada";
  shop: string;
  orderDate: string;
  orderId: string | null;
  productName: string;
  brand: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
  sourceFile: string;
}[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const values: InsertSalesOrder[] = orders.map(o => ({
    platform: o.platform,
    shop: o.shop as "Japan Stationery" | "Elite Camp",
    orderDate: o.orderDate,
    orderId: o.orderId,
    productName: o.productName,
    brand: o.brand,
    unitPrice: o.unitPrice.toFixed(2),
    quantity: o.quantity,
    subtotal: o.subtotal.toFixed(2),
    sourceFile: o.sourceFile,
  }));

  const batchSize = 200;
  for (let i = 0; i < values.length; i += batchSize) {
    await db.insert(salesOrders).values(values.slice(i, i + batchSize));
  }
}

// ============ File Upload & Import Queries ============

/** Most recent successfully imported upload with the same content hash, if any. */
export async function getImportedFileByHash(fileHash: string) {
  const db = await getDb();
  if (!db) return undefined;

  const rows = await db.select().from(uploadedFiles)
    .where(and(eq(uploadedFiles.fileHash, fileHash), eq(uploadedFiles.importStatus, "imported")))
    .orderBy(sql`${uploadedFiles.uploadedAt} DESC`)
    .limit(1);
  return rows[0];
}

/** Most recent successfully imported upload with the same original filename for a shop, if any. */
export async function getImportedFileByName(originalName: string, shop: string) {
  const db = await getDb();
  if (!db) return undefined;

  const rows = await db.select().from(uploadedFiles)
    .where(and(
      eq(uploadedFiles.originalName, originalName),
      eq(uploadedFiles.shop, shop as "Japan Stationery" | "Elite Camp"),
      eq(uploadedFiles.importStatus, "imported"),
    ))
    .orderBy(sql`${uploadedFiles.uploadedAt} DESC`)
    .limit(1);
  return rows[0];
}

export async function createUploadedFile(file: {
  fileUrl: string;
  fileKey: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  uploadedBy: number;
  shop: string;
  fileHash?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const result = await db.insert(uploadedFiles).values({
    fileUrl: file.fileUrl,
    fileKey: file.fileKey,
    originalName: file.originalName,
    mimeType: file.mimeType,
    fileSize: file.fileSize,
    uploadedBy: file.uploadedBy,
    shop: file.shop as 'Japan Stationery' | 'Elite Camp',
    fileHash: file.fileHash,
    importStatus: 'pending',
  });

  return result[0].insertId;
}

export async function updateFileStatus(id: number, status: string, error?: string, ordersImported?: number) {
  const db = await getDb();
  if (!db) return;

  const setMap: Record<string, unknown> = { importStatus: status };
  if (error !== undefined) setMap.importError = error;
  if (ordersImported !== undefined) setMap.ordersImported = ordersImported;

  await db.update(uploadedFiles).set(setMap).where(eq(uploadedFiles.id, id));
}

export async function getUploadedFiles() {
  const db = await getDb();
  if (!db) return [];

  const results = await db.select().from(uploadedFiles).orderBy(sql`${uploadedFiles.uploadedAt} DESC`);
  return results;
}
