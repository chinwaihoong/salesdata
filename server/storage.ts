// Optional S3-compatible file storage for keeping copies of uploaded Excel files.
//
// Configure with S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, and
// optionally S3_ENDPOINT (for Cloudflare R2 / MinIO / etc.) and S3_REGION.
// When unconfigured, imports still work — files are parsed and discarded,
// and duplicate protection relies on the stored content hash.

export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.S3_BUCKET &&
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY
  );
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  if (!isStorageConfigured()) {
    throw new Error("File storage is not configured (set S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)");
  }

  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: process.env.S3_REGION || "auto",
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });

  const key = appendHashSuffix(relKey.replace(/^\/+/, ""));
  await client.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET!,
    Key: key,
    Body: typeof data === "string" ? Buffer.from(data) : Buffer.from(data),
    ContentType: contentType,
  }));

  return { key, url: `s3://${process.env.S3_BUCKET}/${key}` };
}

/** Store a file when storage is configured; return null (and keep going) when it isn't. */
export async function storagePutIfConfigured(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType?: string,
): Promise<{ key: string; url: string } | null> {
  if (!isStorageConfigured()) return null;
  return storagePut(relKey, data, contentType);
}
