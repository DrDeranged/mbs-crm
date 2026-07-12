import { gzip } from "zlib";
import { promisify } from "util";
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { db } from "@workspace/db";
import { jobRunsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { gatherBackupPayload } from "./backupExport";
import { captureException } from "./sentry";
import { logger } from "./logger";

const gzipAsync = promisify(gzip);

let running = false;

function getS3Client(): S3Client | null {
  const endpoint = process.env["B2_ENDPOINT"];
  const keyId = process.env["B2_KEY_ID"];
  const appKey = process.env["B2_APPLICATION_KEY"];
  const bucket = process.env["B2_BUCKET_NAME"];

  if (!endpoint || !keyId || !appKey || !bucket) {
    return null;
  }

  const endpointUrl = endpoint.startsWith("http") ? endpoint : `https://${endpoint}`;

  const regionMatch = endpoint.match(/s3\.([^.]+)\.backblazeb2\.com/) ||
    endpoint.match(/([^.]+)\.backblazeb2\.com/);
  const region = regionMatch?.[1] ?? "us-west-004";

  return new S3Client({
    endpoint: endpointUrl,
    region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: keyId,
      secretAccessKey: appKey,
    },
  });
}

async function todayBackupExists(client: S3Client, bucket: string, key: string): Promise<boolean> {
  try {
    const resp = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: key,
      MaxKeys: 1,
    }));
    return (resp.Contents?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

async function deleteOldBackups(client: S3Client, bucket: string): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const resp = await client.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: "backups/",
  }));

  const toDelete = (resp.Contents ?? []).filter((obj) => {
    return obj.Key && obj.LastModified && obj.LastModified < cutoff;
  });

  if (toDelete.length === 0) return 0;

  await client.send(new DeleteObjectsCommand({
    Bucket: bucket,
    Delete: { Objects: toDelete.map((o) => ({ Key: o.Key! })) },
  }));

  return toDelete.length;
}

export async function runBackupJob(): Promise<void> {
  const bucket = process.env["B2_BUCKET_NAME"];
  const client = getS3Client();

  if (!client || !bucket) {
    logger.warn("B2 credentials not configured — skipping backup job (set B2_BUCKET_NAME, B2_KEY_ID, B2_APPLICATION_KEY, B2_ENDPOINT)");
    return;
  }

  if (running) {
    logger.warn("Backup job already running, skipping overlapping run");
    return;
  }
  running = true;

  const startedAt = new Date();
  let status: "success" | "error" = "success";
  let itemsProcessed = 0;
  let errorMessage: string | undefined;
  let bytesUploaded = 0;

  const dateStr = new Date().toISOString().slice(0, 10);
  const objectKey = `backups/mbs-crm-backup-${dateStr}.json.gz`;

  try {
    if (await todayBackupExists(client, bucket, objectKey)) {
      logger.info({ objectKey }, "Backup for today already exists — skipping");
      running = false;
      return;
    }

    logger.info("Starting nightly backup to Backblaze B2");
    const payload = await gatherBackupPayload();
    const json = JSON.stringify(payload);
    const compressed = await gzipAsync(Buffer.from(json, "utf-8"));
    bytesUploaded = compressed.length;

    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: compressed,
      ContentType: "application/gzip",
      ContentEncoding: "gzip",
    }));

    const totalRecords = Object.values(payload.counts).reduce((a, b) => a + b, 0);
    itemsProcessed = totalRecords;

    const deleted = await deleteOldBackups(client, bucket);
    logger.info({ objectKey, bytesUploaded, totalRecords, deleted }, "Backup completed successfully");
  } catch (err) {
    status = "error";
    errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Backup job failed");
    captureException(err, { job: "backup" });
  } finally {
    running = false;
    db.insert(jobRunsTable)
      .values({
        jobName: "backup",
        startedAt,
        finishedAt: new Date(),
        status,
        itemsProcessed,
        errorMessage: errorMessage ?? null,
      })
      .catch((dbErr: unknown) => {
        logger.error({ err: dbErr }, "Failed to write backup job run");
      });
  }
}
