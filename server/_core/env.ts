export const ENV = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  isProduction: process.env.NODE_ENV === "production",
};
