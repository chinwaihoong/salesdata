import { describe, expect, it, vi, beforeEach } from "vitest";
import * as XLSX from "xlsx";
import { parseExcelOrders, importExcelData, extractBrand, sha256Hex, OverlapError } from "./importer";
import * as db from "./db";

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getExistingOrderKeys: vi.fn().mockResolvedValue([]),
    countLegacyRowsInRange: vi.fn().mockResolvedValue(0),
    insertSalesOrders: vi.fn().mockResolvedValue(undefined),
  };
});

function makeXlsx(sheetName: string, rows: any[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const SHOPEE_HEADER = ["Order ID", "Order Status", "Order Creation Date", "Product Name", "Deal Price", "Quantity", "Product Subtotal"];

function shopeeFile(rows: any[][], sheetName = "orders"): Buffer {
  return makeXlsx(sheetName, [SHOPEE_HEADER, ...rows]);
}

const LAZADA_HEADER = ["orderNumber", "status", "createTime", "itemName", "paidPrice"];

function lazadaFile(rows: any[][], header: any[] = LAZADA_HEADER): Buffer {
  return makeXlsx("Sheet1", [header, ...rows]);
}

describe("parseExcelOrders — Shopee", () => {
  it("parses completed Shopee orders and captures the order ID", async () => {
    const buf = shopeeFile([
      ["2506ABC123", "Completed", "2025-06-15 10:30", "Pentel Graph Gear 500", 29.9, 2, 59.8],
      ["2506ABC124", "Cancelled", "2025-06-16 11:00", "Uni Kuru Toga", 35.0, 1, 35.0],
    ]);
    const result = await parseExcelOrders(buf, "Order.all.20250601_20250630.xlsx", "Japan Stationery");

    expect(result.platform).toBe("Shopee");
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({
      platform: "Shopee",
      orderId: "2506ABC123",
      orderDate: "2025-06-15",
      productName: "Pentel Graph Gear 500",
      brand: "Pentel",
      quantity: 2,
      subtotal: 59.8,
    });
    expect(result.minDate).toBe("2025-06-15");
    expect(result.maxDate).toBe("2025-06-15");
  });

  it("detects Shopee format by headers even with a renamed file and different sheet name", async () => {
    const buf = shopeeFile(
      [["X1", "Completed", "2025-01-05 09:00", "Zebra Mildliner", 8.5, 1, 8.5]],
      "export"
    );
    const result = await parseExcelOrders(buf, "random-name.xlsx", "Japan Stationery");
    expect(result.platform).toBe("Shopee");
    expect(result.orders[0].brand).toBe("Zebra");
  });

  it("throws a clear error when required Shopee columns are missing", async () => {
    const buf = makeXlsx("orders", [
      ["Order Status", "Product Name"], // missing date/price/qty/subtotal
      ["Completed", "Pentel Pen"],
    ]);
    await expect(parseExcelOrders(buf, "Order.all.x.xlsx", "Japan Stationery"))
      .rejects.toThrow(/missing required column/i);
  });
});

describe("parseExcelOrders — Lazada", () => {
  it("parses confirmed Lazada rows as one unit each by default", async () => {
    const buf = lazadaFile([
      ["LZ001", "confirmed", "13 Jan 2025", "Uni Jetstream Pen", 12.5],
      ["LZ002", "cancelled", "14 Jan 2025", "Pilot G2", 9.9],
    ]);
    const result = await parseExcelOrders(buf, "lazada-compiled.xlsx", "Japan Stationery");

    expect(result.platform).toBe("Lazada");
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({
      orderId: "LZ001",
      orderDate: "2025-01-13",
      quantity: 1,
      unitPrice: 12.5,
      subtotal: 12.5,
      brand: "Uni",
    });
  });

  it("honors an explicit quantity column and derives unit price", async () => {
    const buf = lazadaFile(
      [["LZ003", "confirmed", "2025-02-01", "Tombow Airpress", 30.0, 3]],
      [...LAZADA_HEADER, "quantity"]
    );
    const result = await parseExcelOrders(buf, "lazada.xlsx", "Elite Camp");
    expect(result.orders[0].quantity).toBe(3);
    expect(result.orders[0].subtotal).toBe(30.0);
    expect(result.orders[0].unitPrice).toBe(10.0);
  });

  it("parses Excel date serials", async () => {
    // 45658 = 2025-01-01
    const buf = lazadaFile([["LZ004", "confirmed", 45658, "Kokuyo Dotliner", 15.0]]);
    const result = await parseExcelOrders(buf, "lazada.xlsx", "Japan Stationery");
    expect(result.orders[0].orderDate).toBe("2025-01-01");
  });

  it("works without an order-number column (legacy compiled files)", async () => {
    const buf = lazadaFile(
      [["confirmed", "13 Jan 2025", "Pentel Ain Lead", 5.5]],
      ["status", "createTime", "itemName", "paidPrice"]
    );
    const result = await parseExcelOrders(buf, "lazada.xlsx", "Japan Stationery");
    expect(result.orders[0].orderId).toBeNull();
  });
});

describe("parseExcelOrders — unrecognized files", () => {
  it("throws a descriptive error listing the headers it found", async () => {
    const buf = makeXlsx("Sheet1", [["foo", "bar"], [1, 2]]);
    await expect(parseExcelOrders(buf, "mystery.xlsx", "Japan Stationery"))
      .rejects.toThrow(/Unrecognized file format.*Found headers: foo, bar/s);
  });

  it("throws when a valid file contains no importable orders", async () => {
    const buf = shopeeFile([["X", "Cancelled", "2025-06-15", "Pen", 10, 1, 10]]);
    await expect(parseExcelOrders(buf, "Order.all.x.xlsx", "Japan Stationery"))
      .rejects.toThrow(/No valid orders/);
  });
});

describe("importExcelData — duplicate protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.getExistingOrderKeys as any).mockResolvedValue([]);
    (db.countLegacyRowsInRange as any).mockResolvedValue(0);
    (db.insertSalesOrders as any).mockResolvedValue(undefined);
  });

  it("skips rows whose (orderId, productName) already exist", async () => {
    (db.getExistingOrderKeys as any).mockResolvedValue([
      { orderId: "2506ABC123", productName: "Pentel Graph Gear 500" },
    ]);
    const buf = shopeeFile([
      ["2506ABC123", "Completed", "2025-06-15", "Pentel Graph Gear 500", 29.9, 2, 59.8],
      ["2506NEW001", "Completed", "2025-06-16", "Uni Kuru Toga", 35.0, 1, 35.0],
    ]);

    const result = await importExcelData(buf, "Order.all.x.xlsx", "Japan Stationery");
    expect(result.ordersImported).toBe(1);
    expect(result.duplicatesSkipped).toBe(1);
    const inserted = (db.insertSalesOrders as any).mock.calls[0][0];
    expect(inserted).toHaveLength(1);
    expect(inserted[0].orderId).toBe("2506NEW001");
  });

  it("blocks the import when the range overlaps legacy rows without order IDs", async () => {
    (db.countLegacyRowsInRange as any).mockResolvedValue(120);
    const buf = shopeeFile([["A1", "Completed", "2025-06-15", "Pentel Pen", 10, 1, 10]]);

    await expect(importExcelData(buf, "Order.all.x.xlsx", "Japan Stationery"))
      .rejects.toThrow(OverlapError);
    expect(db.insertSalesOrders).not.toHaveBeenCalled();
  });

  it("proceeds past legacy overlap when allowOverlap is set", async () => {
    (db.countLegacyRowsInRange as any).mockResolvedValue(120);
    const buf = shopeeFile([["A1", "Completed", "2025-06-15", "Pentel Pen", 10, 1, 10]]);

    const result = await importExcelData(buf, "Order.all.x.xlsx", "Japan Stationery", { allowOverlap: true });
    expect(result.ordersImported).toBe(1);
    expect(db.countLegacyRowsInRange).not.toHaveBeenCalled();
  });
});

describe("helpers", () => {
  it("extractBrand unifies Mitsubishi/Uniball under Uni", () => {
    expect(extractBrand("Mitsubishi Hi-Uni Pencil")).toBe("Uni");
    expect(extractBrand("Uniball Signo Pen")).toBe("Uni");
    expect(extractBrand("Pentel Ain Lead")).toBe("Pentel");
    expect(extractBrand("Generic Pen")).toBe("Other");
  });

  it("extractBrand requires word boundaries — 'Junior' is not Uni", () => {
    expect(extractBrand("Iwatani Windproof Camping Stove Butane Gas Junior Compact")).toBe("Iwatani");
    expect(extractBrand("Junior Pencil Case")).toBe("Other");
    expect(extractBrand("Uni-ball One Gel Pen")).toBe("Uni");
    expect(extractBrand("Hi-Uni Pencil 2B")).toBe("Uni");
  });

  it("sha256Hex is stable and content-sensitive", () => {
    const a = sha256Hex(Buffer.from("hello"));
    expect(a).toBe(sha256Hex(Buffer.from("hello")));
    expect(a).not.toBe(sha256Hex(Buffer.from("hello!")));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
