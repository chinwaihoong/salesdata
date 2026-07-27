import { createHash, timingSafeEqual } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { ONE_YEAR_MS } from "@shared/const";
import type { User } from "../drizzle/schema";

/**
 * Standalone admin authentication (replaces Manus OAuth).
 *
 * One admin identity, unlocked by ADMIN_PASSWORD. A successful login gets a
 * signed JWT in the session cookie; the context verifies it locally on every
 * request. Dashboard viewing stays public — only upload/import needs this.
 */

function getSessionSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not configured");
  return new TextEncoder().encode(secret);
}

export function isAuthConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD && process.env.JWT_SECRET);
}

export function checkAdminPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  // Hash both sides so timingSafeEqual gets equal-length buffers
  const a = createHash("sha256").update(password).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function createSessionToken(): Promise<string> {
  const expirationSeconds = Math.floor((Date.now() + ONE_YEAR_MS) / 1000);
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(expirationSeconds)
    .sign(getSessionSecret());
}

/** The synthetic admin user attached to authenticated requests. */
export function adminUser(): User {
  const now = new Date();
  return {
    id: 1,
    openId: "admin",
    name: process.env.ADMIN_NAME || "Admin",
    email: null,
    loginMethod: "password",
    role: "admin",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
  };
}

export async function verifySessionToken(token: string | undefined | null): Promise<User | null> {
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    const { payload } = await jwtVerify(token, getSessionSecret(), { algorithms: ["HS256"] });
    if (payload.role !== "admin") return null;
    return adminUser();
  } catch {
    return null;
  }
}
