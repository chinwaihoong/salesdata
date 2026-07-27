import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, bigint } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Sales orders table storing parsed order data from Shopee and Lazada.
 */
export const salesOrders = mysqlTable("sales_orders", {
  id: int("id").autoincrement().primaryKey(),
  /** Platform source: "Shopee" or "Lazada" */
  platform: mysqlEnum("platform", ["Shopee", "Lazada"]).notNull(),
  /** Shop that owns the order data */
  shop: mysqlEnum("shop", ["Japan Stationery", "Elite Camp"]).default("Japan Stationery").notNull(),
  /** Order creation date as a string (YYYY-MM-DD) */
  orderDate: varchar("orderDate", { length: 10 }).notNull(),
  /** Product name */
  productName: text("productName").notNull(),
  /** Extracted brand from product name */
  brand: varchar("brand", { length: 50 }).notNull(),
  /** Unit deal/sale price in MYR */
  unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }).notNull(),
  /** Quantity ordered */
  quantity: int("quantity").notNull(),
  /** Product subtotal (unitPrice * quantity) in MYR */
  subtotal: decimal("subtotal", { precision: 12, scale: 2 }).notNull(),
  /** Source filename */
  sourceFile: varchar("sourceFile", { length: 500 }).notNull(),
  /** Timestamp when this record was imported */
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SalesOrder = typeof salesOrders.$inferSelect;
export type InsertSalesOrder = typeof salesOrders.$inferInsert;

/**
 * Uploaded files tracking for the file upload feature.
 */
export const uploadedFiles = mysqlTable("uploaded_files", {
  id: int("id").autoincrement().primaryKey(),
  /** S3 storage URL for the uploaded file */
  fileUrl: varchar("fileUrl", { length: 1024 }).notNull(),
  /** S3 storage key */
  fileKey: varchar("fileKey", { length: 512 }).notNull(),
  /** Original filename */
  originalName: varchar("originalName", { length: 500 }).notNull(),
  /** MIME type */
  mimeType: varchar("mimeType", { length: 100 }).notNull(),
  /** File size in bytes */
  fileSize: bigint("fileSize", { mode: "number" }).notNull(),
  /** Upload timestamp */
  uploadedAt: timestamp("uploadedAt").defaultNow().notNull(),
  /** Uploaded by user ID */
  uploadedBy: int("uploadedBy").notNull(),
  /** Shop selected for this import */
  shop: mysqlEnum("shop", ["Japan Stationery", "Elite Camp"]).default("Japan Stationery").notNull(),
  /** Import status: pending, importing, imported, failed */
  importStatus: mysqlEnum("importStatus", ["pending", "importing", "imported", "failed"]).default("pending").notNull(),
  /** Import error message if failed */
  importError: text("importError"),
  /** Number of orders imported */
  ordersImported: int("ordersImported").default(0),
});

export type UploadedFile = typeof uploadedFiles.$inferSelect;
export type InsertUploadedFile = typeof uploadedFiles.$inferInsert;
