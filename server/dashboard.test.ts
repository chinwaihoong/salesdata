import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";

// Import the pure helper functions directly (they are exported from db.ts but the module is mocked)
// We need to import them before the mock, or use a separate import path
import {
  shortenProductName as _shortenProductName,
  canonicalizeBrand as _canonicalizeBrand,
  computeMonthlyTrends as _computeMonthlyTrends,
  shiftMonth as _shiftMonth,
} from "./db";

// Mock the database module
vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getDashboardOverview: vi.fn(),
    getSalesByDay: vi.fn(),
    getSalesByWeek: vi.fn(),
    getSalesByMonth: vi.fn(),
    getSalesByYear: vi.fn(),
    getPlatformComparison: vi.fn(),
    getPlatformComparisonYearly: vi.fn(),
    getShopPlatformComparison: vi.fn(),
    getShopPlatformComparisonYearly: vi.fn(),
    getBrandComparison: vi.fn(),
    getTopItemsByQuantity: vi.fn(),
    getTopItemsByValue: vi.fn(),
    getMonthlyTrends: vi.fn(),
    getOrderMetrics: vi.fn(),
    getOrdersForExport: vi.fn(),
    getImportedFileByHash: vi.fn(),
    getImportedFileByName: vi.fn(),
    getUploadedFiles: vi.fn(),
    createUploadedFile: vi.fn(),
    updateFileStatus: vi.fn(),
    upsertUser: vi.fn(),
    getUserByOpenId: vi.fn(),
    getDb: vi.fn(),
  };
});

const mockUser = {
  id: 1,
  openId: "test-user",
  email: "test@example.com",
  name: "Test User",
  loginMethod: "manus",
  role: "admin" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

const mockContext: TrpcContext = {
  user: mockUser,
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: { clearCookie: vi.fn() } as any,
};

describe("dashboard API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns overview data with correct structure", async () => {
    const mockOverview = {
      totalOrders: 41270,
      totalSales: 1500000.50,
      totalQuantity: 50000,
      activeDays: 1200,
      platformSales: [
        { platform: "Shopee", orders: 28853, sales: 1200000, quantity: 35000 },
        { platform: "Lazada", orders: 12417, sales: 300000.50, quantity: 15000 },
      ],
      brandSales: [
        { brand: "Pentel", orders: 5000, sales: 200000, quantity: 6000 },
      ],
      availablePlatforms: ["Lazada", "Shopee"],
      availableBrands: ["Pentel", "Uni", "Kokuyo", "Other"],
    };
    (db.getDashboardOverview as any).mockResolvedValue(mockOverview);

    const caller = appRouter.createCaller(mockContext);
    const result = await caller.dashboard.overview({});

    expect(result.totalOrders).toBe(41270);
    expect(result.totalSales).toBe(1500000.50);
    expect(result.platformSales).toHaveLength(2);
    expect(result.availablePlatforms).toContain("Shopee");
    expect(result.availableBrands).toContain("Pentel");
    // Mitsubishi should not appear (unified to Uni)
    expect(result.availableBrands).not.toContain("Mitsubishi");
  });

  it("applies filters to overview", async () => {
    (db.getDashboardOverview as any).mockResolvedValue({
      totalOrders: 1000,
      totalSales: 50000,
      totalQuantity: 1200,
      activeDays: 30,
      platformSales: [],
      brandSales: [],
      availablePlatforms: ["Shopee"],
      availableBrands: ["Pentel"],
    });

    const caller = appRouter.createCaller(mockContext);
    await caller.dashboard.overview({
      startDate: "2024-01-01",
      endDate: "2024-12-31",
      platform: "Shopee",
      brand: "Pentel",
      shop: "Japan Stationery",
    });

    expect(db.getDashboardOverview).toHaveBeenCalledWith({
      startDate: "2024-01-01",
      endDate: "2024-12-31",
      platform: "Shopee",
      brand: "Pentel",
      shop: "Japan Stationery",
    });
  });

  it("returns sales by month data", async () => {
    const mockData = [
      { month: "2023-01", sales: 10000, quantity: 150, orders: 384 },
      { month: "2023-02", sales: 12000, quantity: 180, orders: 359 },
    ];
    (db.getSalesByMonth as any).mockResolvedValue(mockData);

    const caller = appRouter.createCaller(mockContext);
    const result = await caller.dashboard.salesByMonth({});

    expect(result).toHaveLength(2);
    expect(result[0].month).toBe("2023-01");
    expect(result[0].sales).toBe(10000);
  });

  it("returns top items by quantity with displayName", async () => {
    const mockData = [
      { productName: "Japan Version Pentel Graph Gear 500 Drafting Mech Pencil 0.3 0.4 0.5 0.7 0.9mm PG513 PG514 PG515 PG517 PG519", brand: "Pentel", totalQty: 500, totalSales: 14950, avgPrice: 29.90, orderCount: 500, displayName: "Pentel Graph Gear 500" },
    ];
    (db.getTopItemsByQuantity as any).mockResolvedValue(mockData);

    const caller = appRouter.createCaller(mockContext);
    const result = await caller.dashboard.topItemsByQuantity({});

    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe("Pentel Graph Gear 500");
    expect(result[0].totalQty).toBe(500);
  });

  it("returns top items by value with displayName", async () => {
    const mockData = [
      { productName: "Auto Lead Rotation Uni Kuru Toga Roulette Model Mechanical Pencil (0.5mm)", brand: "Uni", totalQty: 500, totalSales: 14950, avgPrice: 29.90, orderCount: 500, displayName: "Uni Kuru Toga Roulette" },
    ];
    (db.getTopItemsByValue as any).mockResolvedValue(mockData);

    const caller = appRouter.createCaller(mockContext);
    const result = await caller.dashboard.topItemsByValue({});

    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe("Uni Kuru Toga Roulette");
    expect(result[0].totalSales).toBe(14950);
  });

  it("returns brand comparison data with unified brands", async () => {
    // The mock returns canonicalized data (as the real db.getBrandComparison does)
    // Mitsubishi has already been canonicalized to "Uni" in the db layer
    const mockData = [
      { brand: "Pentel", sales: 200000, quantity: 6000, orders: 5000 },
      { brand: "Uni", sales: 180000, quantity: 5500, orders: 4500 },
      { brand: "Uni", sales: 150000, quantity: 5000, orders: 4000 },
      { brand: "Kokuyo", sales: 100000, quantity: 3000, orders: 2000 },
    ];
    (db.getBrandComparison as any).mockResolvedValue(mockData);

    const caller = appRouter.createCaller(mockContext);
    const result = await caller.dashboard.brandComparison({});

    // Brand comparison returns all rows (canonicalization happens in import and query)
    expect(result).toHaveLength(4);
    expect(result[0].brand).toBe("Pentel");
    // No Mitsubishi rows should exist (all canonicalized to Uni)
    expect(result.some(r => r.brand === "Mitsubishi")).toBe(false);
  });

  it("returns platform comparison data", async () => {
    const mockData = [
      { period: "2023-01", platform: "Shopee", sales: 8000, quantity: 120 },
      { period: "2023-01", platform: "Lazada", sales: 2000, quantity: 30 },
    ];
    (db.getPlatformComparison as any).mockResolvedValue(mockData);

    const caller = appRouter.createCaller(mockContext);
    const result = await caller.dashboard.platformComparison({});

    expect(result).toHaveLength(2);
    expect(result[0].platform).toBe("Shopee");
    expect(result[0].period).toBe("2023-01");
  });

  it("returns yearly platform comparison data", async () => {
    const mockData = [
      { period: "2023", platform: "Shopee", sales: 80000, quantity: 1200 },
      { period: "2023", platform: "Lazada", sales: 20000, quantity: 300 },
    ];
    (db.getPlatformComparisonYearly as any).mockResolvedValue(mockData);

    const caller = appRouter.createCaller(mockContext);
    const result = await caller.dashboard.platformComparisonYearly({});

    expect(result).toHaveLength(2);
    expect(result[0].platform).toBe("Shopee");
    expect(result[0].period).toBe("2023");
  });

  it("returns shop platform comparison data with shop dimension", async () => {
    const mockData = [
      { period: "2024-01", shop: "Japan Stationery", platform: "Shopee", sales: 50000, quantity: 600 },
      { period: "2024-01", shop: "Japan Stationery", platform: "Lazada", sales: 10000, quantity: 120 },
      { period: "2024-01", shop: "Elite Camp", platform: "Shopee", sales: 8000, quantity: 90 },
      { period: "2024-01", shop: "Elite Camp", platform: "Lazada", sales: 2000, quantity: 25 },
    ];
    (db.getShopPlatformComparison as any).mockResolvedValue(mockData);

    const caller = appRouter.createCaller(mockContext);
    const result = await caller.dashboard.shopPlatformComparison({});

    expect(result).toHaveLength(4);
    expect(result[0].shop).toBe("Japan Stationery");
    expect(result[2].shop).toBe("Elite Camp");
  });

  it("returns monthly trends with MoM and YoY change", async () => {
    const mockData = [
      { month: "2025-06", sales: 10000, quantity: 100, lines: 80, momPct: null, yoyPct: null, prevYearSales: null },
      { month: "2025-07", sales: 12000, quantity: 120, lines: 95, momPct: 20, yoyPct: null, prevYearSales: null },
      { month: "2026-07", sales: 15000, quantity: 150, lines: 110, momPct: 5, yoyPct: 25, prevYearSales: 12000 },
    ];
    (db.getMonthlyTrends as any).mockResolvedValue(mockData);

    const caller = appRouter.createCaller(mockContext);
    const result = await caller.dashboard.monthlyTrends({ shop: "Japan Stationery" });

    expect(result).toHaveLength(3);
    expect(result[2].yoyPct).toBe(25);
    expect(db.getMonthlyTrends).toHaveBeenCalledWith({ shop: "Japan Stationery" });
  });

  it("returns order metrics with coverage", async () => {
    (db.getOrderMetrics as any).mockResolvedValue({
      uniqueOrders: 500,
      avgOrderValue: 45.5,
      avgItemsPerOrder: 2.3,
      avgLinesPerOrder: 1.4,
      coveragePct: 12.5,
    });

    const caller = appRouter.createCaller(mockContext);
    const result = await caller.dashboard.orderMetrics({});

    expect(result.uniqueOrders).toBe(500);
    expect(result.avgOrderValue).toBe(45.5);
    expect(result.coveragePct).toBe(12.5);
  });

  it("exports filtered orders as an Excel workbook with summary sheets", async () => {
    (db.getOrdersForExport as any).mockResolvedValue([
      { orderDate: "2025-06-15", platform: "Shopee", shop: "Japan Stationery", brand: "Pentel", productName: "Graph Gear 500", orderId: "A1", quantity: 2, unitPrice: "29.90", subtotal: "59.80", sourceFile: "Order.all.x.xlsx" },
      { orderDate: "2025-07-01", platform: "Lazada", shop: "Japan Stationery", brand: "Mitsubishi", productName: "Hi-Uni Pencil", orderId: null, quantity: 1, unitPrice: "5.00", subtotal: "5.00", sourceFile: "laz.xlsx" },
    ]);

    const caller = appRouter.createCaller(mockContext);
    const result = await caller.dashboard.exportOrders({ shop: "Japan Stationery" });

    expect(result.rowCount).toBe(2);
    expect(result.fileName).toContain("Japan-Stationery");

    const XLSX = await import("xlsx");
    const wb = XLSX.read(Buffer.from(result.base64, "base64"), { type: "buffer" });
    expect(wb.SheetNames).toEqual(["Orders", "Monthly Summary", "Brand Summary", "Shop-Platform Summary"]);
    const orders = XLSX.utils.sheet_to_json(wb.Sheets["Orders"]) as any[];
    expect(orders).toHaveLength(2);
    // Brand canonicalization applies in the export too
    expect(orders[1]["Brand"]).toBe("Uni");
    const monthly = XLSX.utils.sheet_to_json(wb.Sheets["Monthly Summary"]) as any[];
    expect(monthly.map(m => m["Month"])).toEqual(["2025-06", "2025-07"]);
  });

  it("rejects export when no rows match", async () => {
    (db.getOrdersForExport as any).mockResolvedValue([]);
    const caller = appRouter.createCaller(mockContext);
    await expect(caller.dashboard.exportOrders({})).rejects.toThrow(/No orders match/);
  });

  it("returns yearly shop platform comparison data", async () => {
    const mockData = [
      { period: "2024", shop: "Japan Stationery", platform: "Shopee", sales: 600000, quantity: 7200 },
      { period: "2024", shop: "Elite Camp", platform: "Shopee", sales: 96000, quantity: 1080 },
    ];
    (db.getShopPlatformComparisonYearly as any).mockResolvedValue(mockData);

    const caller = appRouter.createCaller(mockContext);
    const result = await caller.dashboard.shopPlatformComparisonYearly({});

    expect(result).toHaveLength(2);
    expect(result[0].shop).toBe("Japan Stationery");
    expect(result[1].shop).toBe("Elite Camp");
  });
});

describe("upload API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns uploaded files list for admin", async () => {
    const mockFiles = [
      { id: 1, originalName: "Order.all.20260801_20260831.xlsx", importStatus: "imported", ordersImported: 500 },
    ];
    (db.getUploadedFiles as any).mockResolvedValue(mockFiles);

    const caller = appRouter.createCaller(mockContext);
    const result = await caller.upload.getUploadedFiles();

    expect(result).toHaveLength(1);
    expect(result[0].originalName).toBe("Order.all.20260801_20260831.xlsx");
  });

  it("rejects non-admin from accessing uploaded files", async () => {
    const nonAdminContext = {
      ...mockContext,
      user: { ...mockContext.user, role: "user" as const },
    };
    const caller = appRouter.createCaller(nonAdminContext);

    await expect(caller.upload.getUploadedFiles()).rejects.toThrow();
  });

  it("requires shop field in importExcelFile input", async () => {
    const caller = appRouter.createCaller(mockContext);
    // Should reject input without shop field
    await expect(caller.upload.importExcelFile({
      fileData: "dGVzdA==",
      fileName: "Order.all.test.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    } as any)).rejects.toThrow();
  });

  it("rejects a file whose content hash was already imported", async () => {
    (db.getImportedFileByHash as any).mockResolvedValue({
      id: 7,
      originalName: "Order.all.20260601_20260630.xlsx",
      uploadedAt: new Date("2026-07-01"),
      ordersImported: 850,
    });

    const caller = appRouter.createCaller(mockContext);
    const result = await caller.upload.importExcelFile({
      fileData: Buffer.from("same content").toString("base64"),
      fileName: "renamed-copy.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      shop: "Japan Stationery",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("already imported");
    expect(db.createUploadedFile).not.toHaveBeenCalled();
  });

  it("rejects a filename already imported for the same shop", async () => {
    (db.getImportedFileByHash as any).mockResolvedValue(undefined);
    (db.getImportedFileByName as any).mockResolvedValue({
      id: 8,
      originalName: "Order.all.20260601_20260630.xlsx",
      uploadedAt: new Date("2026-07-01"),
    });

    const caller = appRouter.createCaller(mockContext);
    const result = await caller.upload.importExcelFile({
      fileData: Buffer.from("different content").toString("base64"),
      fileName: "Order.all.20260601_20260630.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      shop: "Japan Stationery",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("already imported");
    expect(db.createUploadedFile).not.toHaveBeenCalled();
  });
});

describe("computeMonthlyTrends", () => {
  it("computes MoM against the previous calendar month, not the previous row", () => {
    // Gap: no 2025-06 data, so 2025-07 has no MoM comparison
    const rows = [
      { month: "2025-05", sales: 1000, quantity: 10, lines: 8 },
      { month: "2025-07", sales: 1200, quantity: 12, lines: 9 },
      { month: "2025-08", sales: 600, quantity: 6, lines: 5 },
    ];
    const result = _computeMonthlyTrends(rows);
    expect(result[0].momPct).toBeNull();
    expect(result[1].momPct).toBeNull(); // 2025-06 missing
    expect(result[2].momPct).toBeCloseTo(-50);
  });

  it("computes YoY across years including the December -> January boundary", () => {
    const rows = [
      { month: "2024-12", sales: 2000, quantity: 20, lines: 15 },
      { month: "2025-01", sales: 1000, quantity: 10, lines: 8 },
      { month: "2025-12", sales: 3000, quantity: 30, lines: 22 },
      { month: "2026-01", sales: 1500, quantity: 15, lines: 11 },
    ];
    const result = _computeMonthlyTrends(rows);
    expect(result[2].yoyPct).toBeCloseTo(50); // 3000 vs 2000
    expect(result[3].yoyPct).toBeCloseTo(50); // 1500 vs 1000
    expect(result[3].momPct).toBeCloseTo(-50); // 1500 vs 3000
    expect(result[3].prevYearSales).toBe(1000);
  });

  it("shiftMonth handles year boundaries", () => {
    expect(_shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(_shiftMonth("2026-01", -12)).toBe("2025-01");
    expect(_shiftMonth("2025-12", -12)).toBe("2024-12");
  });
});
describe("shortenProductName", () => {
  it("shortens Pentel Graph Gear 500 long name", () => {
    const input = "Japan Version Pentel Graph Gear 500 Drafting Mech Pencil 0.3 0.4 0.5 0.7 0.9mm PG513 PG514 PG515 PG517 PG519";
    const result = _shortenProductName(input);
    expect(result).toContain("Pentel");
    expect(result).toContain("Graph Gear 500");
    expect(result).not.toContain("Japan Version");
    expect(result).not.toContain("PG513");
    expect(result).not.toContain("PG519");
  });

  it("shortens Uni Kuru Toga name", () => {
    const input = "Auto Lead Rotation Uni Kuru Toga Roulette Model Mechanical Pencil (0.5mm)";
    const result = _shortenProductName(input);
    expect(result).toContain("Uni");
    expect(result).toContain("Kuru Toga");
    expect(result).not.toContain("Auto Lead Rotation");
    expect(result).not.toContain("(0.5mm)");
  });

  it("shortens Zebra Mildliner name", () => {
    const input = "Original Japan Zebra Mildliner Double Sided Highlighter Set - Pack of 5 Colors";
    const result = _shortenProductName(input);
    expect(result).toContain("Zebra");
    expect(result).toContain("Mildliner");
    expect(result).not.toContain("Original Japan");
  });

  it("shortens Lihit Lab name", () => {
    const input = "Original Lihit Lab Pen / Pencil Case - Smart Fit Compact Type";
    const result = _shortenProductName(input);
    expect(result).toContain("Lihit Lab");
    expect(result).not.toContain("Original");
  });

  it("shortens Pentel Ain name", () => {
    const input = "Japan Pentel Ain Mechanical Pencil Lead 0.2/0.3/0.4/0.5/0.7/0.9/1.3 mm";
    const result = _shortenProductName(input);
    expect(result).toContain("Pentel");
    expect(result).toContain("Ain");
    expect(result).not.toContain("Japan");
  });

  it("shortens Mitsubishi/Uni refill name (without brand param, uses detected brand)", () => {
    const input = "Refill for Mitsubishi Multi Function Jetstream Pen SXR-80-05 (0.5mm)";
    // When called without brand, it detects from the name. Mitsubishi is normalized to Uni in aliases.
    const result = _shortenProductName(input);
    expect(result).toContain("Refill");
    expect(result).toContain("SXR-80");
    // The alias normalization converts Mitsubishi -> Uni in the name itself
    expect(result).not.toContain("Mitsubishi");
  });

  it("shortens Mitsubishi refill with brand param (canonicalized)", () => {
    const input = "Refill for Mitsubishi Multi Function Jetstream Pen SXR-80-05 (0.5mm)";
    const result = _shortenProductName(input, "Uni");
    expect(result).toContain("Uni");
    expect(result).toContain("Refill");
    expect(result).toContain("SXR-80");
    expect(result).not.toContain("Mitsubishi");
  });

  it("shortens Kokuyo Dotliner refill with model code", () => {
    const input = "KOKUYO Dotliner Glue Tape Standard, Long, Hold, Long50, Power (refill or tape set) TA-DM400-08N D400-08N";
    const result = _shortenProductName(input);
    expect(result).toContain("Kokuyo");
    expect(result).toContain("Refill");
    // Should include some model code
    expect(result.length).toBeGreaterThan("Kokuyo Refill".length);
  });

  it("shortens Tombow Airpress refill", () => {
    const input = "Refill for Tombow Airpress Pressurized Ballpoint Pen - 0.7 mm";
    const result = _shortenProductName(input);
    expect(result).toContain("Tombow");
    expect(result).toContain("Refill");
    expect(result).toContain("Airpress");
  });

  it("shortens Uni Hi-Uni refill leads", () => {
    const input = "Uni Mitsubishi Hi-Uni GRCT Mechanical Pencil Refill Leads 0.3/0.5 mm HU033002H HU03300H HU03300HB HU03300B";
    const result = _shortenProductName(input);
    expect(result).toContain("Uni");
    expect(result).toContain("Hi-Uni");
    expect(result).toContain("Refill");
  });

  it("avoids duplicate brand name", () => {
    const input = "Uni Uni Kuru Toga Roulette Model Mechanical Pencil";
    const result = _shortenProductName(input);
    expect(result).not.toMatch(/^Uni\s+Uni/);
    expect(result).toContain("Uni");
    expect(result).toContain("Kuru Toga");
  });
});

describe("canonicalizeBrand", () => {
  it("unifies Mitsubishi to Uni", () => {
    expect(_canonicalizeBrand("Mitsubishi")).toBe("Uni");
  });

  it("unifies Uni-Ball to Uni", () => {
    expect(_canonicalizeBrand("Uni-Ball")).toBe("Uni");
  });

  it("unifies Uniball to Uni", () => {
    expect(_canonicalizeBrand("Uniball")).toBe("Uni");
  });

  it("keeps Uni as Uni", () => {
    expect(_canonicalizeBrand("Uni")).toBe("Uni");
  });

  it("keeps other brands unchanged", () => {
    expect(_canonicalizeBrand("Pentel")).toBe("Pentel");
    expect(_canonicalizeBrand("Zebra")).toBe("Zebra");
  });

  it("returns Other for empty/null", () => {
    expect(_canonicalizeBrand("")).toBe("Other");
    expect(_canonicalizeBrand(null as any)).toBe("Other");
  });
});
