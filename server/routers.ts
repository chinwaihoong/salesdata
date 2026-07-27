import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { canonicalizeBrand, shortenProductName } from "./db";
import * as db from "./db";
import { storagePut } from "./storage";

// Shared filter schema
const filterSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  platform: z.string().optional(),
  brand: z.string().optional(),
  shop: z.string().optional(),
}).default({});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  dashboard: router({
    overview: publicProcedure
      .input(filterSchema)
      .query(async ({ input }) => {
        const result = await db.getDashboardOverview(input);
        if (!result) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        return result;
      }),

    salesByDay: publicProcedure
      .input(filterSchema)
      .query(async ({ input }) => {
        return await db.getSalesByDay(input);
      }),

    salesByWeek: publicProcedure
      .input(filterSchema)
      .query(async ({ input }) => {
        return await db.getSalesByWeek(input);
      }),

    salesByMonth: publicProcedure
      .input(filterSchema)
      .query(async ({ input }) => {
        return await db.getSalesByMonth(input);
      }),

    salesByYear: publicProcedure
      .input(filterSchema)
      .query(async ({ input }) => {
        return await db.getSalesByYear(input);
      }),

    platformComparison: publicProcedure
      .input(filterSchema)
      .query(async ({ input }) => {
        return await db.getPlatformComparison(input);
      }),

    platformComparisonYearly: publicProcedure
      .input(filterSchema)
      .query(async ({ input }) => {
        return await db.getPlatformComparisonYearly(input);
      }),

    shopPlatformComparison: publicProcedure
      .input(filterSchema)
      .query(async ({ input }) => {
        return await db.getShopPlatformComparison(input);
      }),

    shopPlatformComparisonYearly: publicProcedure
      .input(filterSchema)
      .query(async ({ input }) => {
        return await db.getShopPlatformComparisonYearly(input);
      }),

    brandComparison: publicProcedure
      .input(filterSchema)
      .query(async ({ input }) => {
        return await db.getBrandComparison(input);
      }),

    topItemsByQuantity: publicProcedure
      .input(filterSchema)
      .query(async ({ input }) => {
        return await db.getTopItemsByQuantity(input, 50);
      }),

    topItemsByValue: publicProcedure
      .input(filterSchema)
      .query(async ({ input }) => {
        return await db.getTopItemsByValue(input, 50);
      }),
  }),

  upload: router({
    // Admin-only file upload and import
    getUploadedFiles: adminProcedure.query(async () => {
      return await db.getUploadedFiles();
    }),

    importExcelFile: adminProcedure
      .input(z.object({
        fileData: z.string(), // base64 encoded file
        fileName: z.string(),
        mimeType: z.string(),
        shop: z.enum(["Japan Stationery", "Elite Camp"]),
      }))
      .mutation(async ({ input, ctx }) => {
        let fileId = 0;
        try {
          // Upload file to S3
          const fileBuffer = Buffer.from(input.fileData, 'base64');
          const { key, url } = await storagePut(
            `uploads/${Date.now()}_${input.fileName}`,
            fileBuffer,
            input.mimeType
          );

          // Record the uploaded file
          fileId = await db.createUploadedFile({
            fileUrl: url,
            fileKey: key,
            originalName: input.fileName,
            mimeType: input.mimeType,
            fileSize: fileBuffer.length,
            uploadedBy: ctx.user.id,
            shop: input.shop,
          });

          // Update status to importing
          await db.updateFileStatus(fileId, 'importing');

          // Parse and import the Excel file
          const importResult = await importExcelData(fileBuffer, input.fileName, input.shop);

          // Update status to imported
          await db.updateFileStatus(fileId, 'imported', undefined, importResult.ordersImported);

          return {
            success: true,
            fileId,
            ordersImported: importResult.ordersImported,
            message: `Successfully imported ${importResult.ordersImported} orders from ${input.fileName}`,
          };
        } catch (error: any) {
          console.error('[Upload] Import failed:', error);
          // Mark the uploaded file as failed
          try {
            await db.updateFileStatus(fileId || 0, 'failed', error.message || 'Import failed');
          } catch (updateError) {
            console.error('[Upload] Failed to update file status:', updateError);
          }
          return {
            success: false,
            message: error.message || 'Failed to import file',
          };
        }
      }),
  }),
});

function extractBrand(productName: string): string {
  if (!productName) return 'Other';
  const KNOWN_BRANDS = [
    'Uni', 'Zebra', 'Pentel', 'Staedtler', 'Rotring', 'Platinum',
    'DOD', 'Iwatani', 'Olight', 'Kokuyo', 'Pilot', 'Lihit Lab',
    'Tombow', 'Sakura', 'Kuretake', 'Mitsubishi'
  ];
  const upper = productName.toUpperCase();
  if (upper.includes('LIHIT LAB') || upper.includes('LIHITLAB') || upper.includes('LIHIT')) return 'Lihit Lab';
  for (const brand of KNOWN_BRANDS) {
    if (brand === 'Lihit Lab') continue;
    if (upper.includes(brand.toUpperCase())) return brand;
  }
  if (upper.includes('UNI-BALL') || upper.includes('UNIBALL')) return 'Uni';
  if (upper.includes('MITSUBISHI')) return 'Uni'; // Unify Mitsubishi under Uni
  return 'Other';
}

async function importExcelData(fileBuffer: Buffer, fileName: string, shop: string): Promise<{ ordersImported: number }> {
  const XLSX = await import('xlsx');

  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  const sheetNames = workbook.SheetNames;

  // Detect platform from filename
  const isShopee = fileName.startsWith('Order.all.');
  let orders: any[] = [];

  if (isShopee) {
    // Shopee format
    const sheet = workbook.Sheets['orders'];
    if (!sheet) throw new Error('Shopee file missing "orders" sheet');
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    if (rows.length < 2) return { ordersImported: 0 };

    const header = rows[0];
    const statusIdx = header.indexOf('Order Status');
    const dateIdx = header.indexOf('Order Creation Date');
    const productIdx = header.indexOf('Product Name');
    const dealPriceIdx = header.indexOf('Deal Price');
    const quantityIdx = header.indexOf('Quantity');
    const subtotalIdx = header.indexOf('Product Subtotal');

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[statusIdx]) continue;
      const status = String(row[statusIdx]).trim();
      if (status !== 'Completed') continue;

      const dateStr = String(row[dateIdx] || '').trim();
      const dateMatch = dateStr.match(/(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) continue;

      const productName = String(row[productIdx] || '').trim();
      const brand = extractBrand(productName);
      const unitPrice = parseFloat(row[dealPriceIdx]) || 0;
      const quantity = parseInt(row[quantityIdx], 10) || 1;
      const subtotal = parseFloat(row[subtotalIdx]) || 0;

      if (productName && unitPrice > 0) {
        orders.push({
          platform: 'Shopee',
          shop,
          orderDate: dateMatch[1],
          productName,
          brand,
          unitPrice,
          quantity,
          subtotal,
          sourceFile: fileName,
        });
      }
    }
  } else {
    // Lazada format
    const sheet = workbook.Sheets[sheetNames[0]];
    if (!sheet) throw new Error('Lazada file has no data sheet');
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    if (rows.length < 2) return { ordersImported: 0 };

    const header = rows[0];
    const createTimeIdx = header.indexOf('createTime');
    const itemNameIdx = header.indexOf('itemName');
    const paidPriceIdx = header.indexOf('paidPrice');
    const statusIdx = header.indexOf('status');

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const status = String(row[statusIdx] || '').trim().toLowerCase();
      if (status !== 'confirmed') continue;

      const createTimeStr = String(row[createTimeIdx] || '').trim();
      let orderDate = '';
      const dateMatch = createTimeStr.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        orderDate = dateMatch[1];
      } else {
        const parts = createTimeStr.split(' ');
        if (parts.length >= 3) {
          const months: Record<string, string> = {
            jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
            jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
          };
          const day = parts[0].padStart(2, '0');
          const month = months[parts[1].toLowerCase()];
          const year = parts[2];
          if (month && year) orderDate = `${year}-${month}-${day}`;
        }
      }
      if (!orderDate) continue;

      const itemName = String(row[itemNameIdx] || '').trim();
      const brand = extractBrand(itemName);
      const paidPrice = parseFloat(row[paidPriceIdx]) || 0;

      if (itemName && paidPrice > 0) {
        orders.push({
          platform: 'Lazada',
          shop,
          orderDate,
          productName: itemName,
          brand,
          unitPrice: paidPrice,
          quantity: 1,
          subtotal: paidPrice,
          sourceFile: fileName,
        });
      }
    }
  }

  if (orders.length === 0) {
    throw new Error('No valid orders found in the file');
  }

  // Insert into database in batches
  const batchSize = 200;
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL!,
    connectTimeout: 30000,
    ssl: { rejectUnauthorized: true },
  });

  try {
    for (let i = 0; i < orders.length; i += batchSize) {
      const batch = orders.slice(i, i + batchSize);
      const placeholders = batch.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
      const values: any[] = [];
      for (const o of batch) {
        values.push(o.platform, o.shop, o.orderDate, o.productName, o.brand, o.unitPrice, o.quantity, o.subtotal, o.sourceFile);
      }
      await conn.execute(
        `INSERT INTO sales_orders (platform, shop, orderDate, productName, brand, unitPrice, quantity, subtotal, sourceFile) VALUES ${placeholders}`,
        values
      );
    }
  } finally {
    await conn.end();
  }

  return { ordersImported: orders.length };
}

export type AppRouter = typeof appRouter;
