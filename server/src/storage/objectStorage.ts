import crypto from "crypto";

export type StorageCategory =
  | "cover" | "gallery" | "videos" | "code"
  | "cad" | "schematics" | "documents" | "other";

export interface StorageConfig {
  provider: string;      // "s3", "cloudinary", ...
  bucket: string;        // "idevrx-development" | "idevrx-production"
  region?: string;
  accessKey?: string;
  secretKey?: string;
  endpoint?: string;
}

/**
 * Sanitizes a filename for safe storage keys.
 * Prevents path traversal, control characters, and unsafe extensions.
 */
export function safeFilename(original: string): string {
  const base = original
    .replace(/[\/\\]/g, "_")
    .replace(/[\x00-\x1F]/g, "")
    .replace(/[^\w.\-]/g, "_")
    .replace(/_+/g, "_");
  return base.length > 120 ? base.slice(-120) : base;
}

/**
 * Backend-generated storage key.
 * Format (from storage architecture doc):
 *   projects/{projectNumber}/{category}/{fileId}-{safeFilename}
 *
 * For drafts, projectNumber is 0 until publish. The caller MUST pass the
 * currently-known projectNumber (0 for drafts). On publish, drafts that
 * already have files must be re-keyed (see reconcileDraftKeys).
 */
export function buildStorageKey(
  projectNumber: number,
  category: StorageCategory,
  fileId: string,
  originalFilename: string
): string {
  const safe = safeFilename(originalFilename);
  return `projects/${String(projectNumber).padStart(3, "0")}/${category}/${fileId}-${safe}`;
}

export function newFileId(): string {
  return crypto.randomBytes(6).toString("hex");
}

/**
 * Interface for the underlying object storage provider.
 * Implementations: S3ObjectStorage, CloudinaryObjectStorage, etc.
 */
export interface ObjectStorage {
  presignPut(key: string, mimeType: string, size: number): Promise<string>;
  presignGet(key: string, expiresInSeconds: number): Promise<string>;
  deleteObject(key: string): Promise<void>;
  headObject(key: string): Promise<{ size: number; contentType: string } | null>;
}

/**
 * Reconciliation helper — when a draft publishes and its projectNumber
 * changes from 0 to N, all previously uploaded files must be re-keyed.
 * Implementation left to the concrete provider.
 */
export async function reconcileDraftKeys(
  _storage: ObjectStorage,
  _oldKeys: string[],
  _newProjectNumber: number
): Promise<void> {
  throw new Error("RECONCILE_NOT_IMPLEMENTED");
}
