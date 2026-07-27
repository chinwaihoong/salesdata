import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";
import { checkAdminPassword, createSessionToken, verifySessionToken } from "./auth";

function createAnonContext(): { ctx: TrpcContext; setCookies: { name: string; value: string; options: Record<string, unknown> }[] } {
  const setCookies: { name: string; value: string; options: Record<string, unknown> }[] = [];
  const ctx: TrpcContext = {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      cookie: (name: string, value: string, options: Record<string, unknown>) => {
        setCookies.push({ name, value, options });
      },
      clearCookie: vi.fn(),
    } as any,
  };
  return { ctx, setCookies };
}

describe("auth.login", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "correct-horse";
    process.env.JWT_SECRET = "test-secret-for-auth-tests";
  });

  afterEach(() => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.JWT_SECRET;
  });

  it("sets a session cookie for the correct password", async () => {
    const { ctx, setCookies } = createAnonContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.login({ password: "correct-horse" });

    expect(result.success).toBe(true);
    expect(setCookies).toHaveLength(1);
    expect(setCookies[0].name).toBe(COOKIE_NAME);
    const user = await verifySessionToken(setCookies[0].value);
    expect(user?.role).toBe("admin");
  });

  it("rejects a wrong password without setting a cookie", async () => {
    const { ctx, setCookies } = createAnonContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.auth.login({ password: "wrong" })).rejects.toThrow(/Incorrect password/);
    expect(setCookies).toHaveLength(0);
  });

  it("fails with a clear message when auth env vars are missing", async () => {
    delete process.env.ADMIN_PASSWORD;
    const { ctx } = createAnonContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.auth.login({ password: "anything" })).rejects.toThrow(/not configured/);
  });

  it("checkAdminPassword compares safely and handles unset env", () => {
    expect(checkAdminPassword("correct-horse")).toBe(true);
    expect(checkAdminPassword("nope")).toBe(false);
    delete process.env.ADMIN_PASSWORD;
    expect(checkAdminPassword("")).toBe(false);
  });

  it("session tokens round-trip and invalid tokens are rejected", async () => {
    const token = await createSessionToken();
    const user = await verifySessionToken(token);
    expect(user?.role).toBe("admin");
    expect(await verifySessionToken("garbage")).toBeNull();
    expect(await verifySessionToken(null)).toBeNull();
  });
});
