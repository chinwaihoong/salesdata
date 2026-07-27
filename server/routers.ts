import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { canonicalizeBrand, shortenProductName } from "./db";
import * as db from "./db";
import { storagePutIfConfigured } from "./storage";
import { importExcelData, sha256Hex, OverlapError } from "./importer";
import { checkAdminPassword, createSessionToken, isAuthConfigured } from "./auth";
import { ONE_YEAR_MS } from "@shared/const";

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
    login: publicProcedure
      .input(z.object({ password: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        if (!isAuthConfigured()) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Login is not configured: set ADMIN_PASSWORD and JWT_SECRET on the server",
          });
        }
        if (!checkAdminPassword(input.password)) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Incorrect password" });
        }
        const token = await createSessionToken();
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        return { success: true } as const;
      }),
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

    monthlyTrends: publicProcedure
      .input(filterSchema)
      .query(async ({ input }) => {
        return await db.getMonthlyTrends(input);
      }),

    orderMetrics: publicProcedure
      .input(filterSchema)
      .query(async ({ input }) => {
        return await db.getOrderMetrics(input);
      }),

    exportOrders: publicProcedure
      .input(filterSchema)
      .query(async ({ input }) => {
        const rows = await db.getOrdersForExport(input);
        if (rows.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "No orders match the selected filters" });
        }
        const { fileName, base64 } = await buildExportWorkbook(rows, input);
        return { fileName, base64, rowCount: rows.length };
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
        /** Proceed even when the date range overlaps legacy rows without order IDs */
        allowOverlap: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        let fileId = 0;
        try {
          const fileBuffer = Buffer.from(input.fileData, 'base64');
          const fileHash = sha256Hex(fileBuffer);

          // Reject exact duplicates before touching storage or the orders table
          const sameHash = await db.getImportedFileByHash(fileHash);
          if (sameHash) {
            return {
              success: false,
              message: `This exact file was already imported on ${new Date(sameHash.uploadedAt).toLocaleDateString('en-MY')} as "${sameHash.originalName}" (${sameHash.ordersImported?.toLocaleString() || 0} orders). Nothing was imported.`,
            };
          }
          const sameName = await db.getImportedFileByName(input.fileName, input.shop);
          if (sameName) {
            return {
              success: false,
              message: `A file named "${input.fileName}" was already imported for ${input.shop} on ${new Date(sameName.uploadedAt).toLocaleDateString('en-MY')}. If this is a corrected re-export, rename the file to make that explicit before uploading.`,
            };
          }

          // Keep a copy in S3-compatible storage when configured; otherwise import directly
          const stored = await storagePutIfConfigured(
            `uploads/${Date.now()}_${input.fileName}`,
            fileBuffer,
            input.mimeType
          );

          // Record the uploaded file
          fileId = await db.createUploadedFile({
            fileUrl: stored?.url ?? '',
            fileKey: stored?.key ?? '',
            originalName: input.fileName,
            mimeType: input.mimeType,
            fileSize: fileBuffer.length,
            uploadedBy: ctx.user.id,
            shop: input.shop,
            fileHash,
          });

          // Update status to importing
          await db.updateFileStatus(fileId, 'importing');

          // Parse and import the Excel file (with row-level duplicate detection)
          const importResult = await importExcelData(fileBuffer, input.fileName, input.shop, {
            allowOverlap: input.allowOverlap,
          });

          // Update status to imported
          await db.updateFileStatus(fileId, 'imported', undefined, importResult.ordersImported);

          const skippedNote = importResult.duplicatesSkipped > 0
            ? ` (${importResult.duplicatesSkipped.toLocaleString()} duplicate row(s) skipped)`
            : '';
          return {
            success: true,
            fileId,
            ordersImported: importResult.ordersImported,
            duplicatesSkipped: importResult.duplicatesSkipped,
            message: `Successfully imported ${importResult.ordersImported.toLocaleString()} orders from ${input.fileName}${skippedNote}`,
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
            overlap: error instanceof OverlapError,
            message: error.message || 'Failed to import file',
          };
        }
      }),
  }),
});

async function buildExportWorkbook(
  rows: any[],
  filters: { startDate?: string; endDate?: string; platform?: string; brand?: string; shop?: string }
): Promise<{ fileName: string; base64: string }> {
  const XLSX = await import('xlsx');

  const orderSheetRows = rows.map((r: any) => ({
    'Date': r.orderDate,
    'Platform': r.platform,
    'Shop': r.shop,
    'Brand': canonicalizeBrand(r.brand),
    'Product': r.productName,
    'Order ID': r.orderId || '',
    'Qty': Number(r.quantity) || 0,
    'Unit Price (RM)': parseFloat(r.unitPrice) || 0,
    'Subtotal (RM)': parseFloat(r.subtotal) || 0,
    'Source File': r.sourceFile,
  }));

  const summarize = (keyFn: (r: any) => string) => {
    const map = new Map<string, { sales: number; qty: number; lines: number }>();
    for (const r of rows) {
      const key = keyFn(r);
      const entry = map.get(key) || { sales: 0, qty: 0, lines: 0 };
      entry.sales += parseFloat(r.subtotal) || 0;
      entry.qty += Number(r.quantity) || 0;
      entry.lines += 1;
      map.set(key, entry);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  };

  const monthlyRows = summarize(r => String(r.orderDate).slice(0, 7)).map(([month, s]) => ({
    'Month': month, 'Sales (RM)': Math.round(s.sales * 100) / 100, 'Qty': s.qty, 'Lines': s.lines,
  }));
  const brandRows = summarize(r => canonicalizeBrand(r.brand))
    .sort((a, b) => b[1].sales - a[1].sales)
    .map(([brand, s]) => ({
      'Brand': brand, 'Sales (RM)': Math.round(s.sales * 100) / 100, 'Qty': s.qty, 'Lines': s.lines,
    }));
  const platformRows = summarize(r => `${r.shop} / ${r.platform}`).map(([key, s]) => ({
    'Shop / Platform': key, 'Sales (RM)': Math.round(s.sales * 100) / 100, 'Qty': s.qty, 'Lines': s.lines,
  }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(orderSheetRows), 'Orders');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(monthlyRows), 'Monthly Summary');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(brandRows), 'Brand Summary');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(platformRows), 'Shop-Platform Summary');

  const parts = ['sales-export'];
  if (filters.shop && filters.shop !== 'all') parts.push(filters.shop.replace(/\s+/g, '-'));
  if (filters.platform && filters.platform !== 'all') parts.push(filters.platform);
  if (filters.brand && filters.brand !== 'all') parts.push(filters.brand.replace(/\s+/g, '-'));
  if (filters.startDate || filters.endDate) {
    parts.push(`${filters.startDate || 'start'}_to_${filters.endDate || 'now'}`);
  } else {
    parts.push('all-time');
  }
  const fileName = `${parts.join('_')}.xlsx`;

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return { fileName, base64: buffer.toString('base64') };
}

export type AppRouter = typeof appRouter;
