import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "./config.js";

const s3 = new S3Client({
  region: config.S3_REGION,
  endpoint: config.S3_ENDPOINT,
  forcePathStyle: !!config.S3_ENDPOINT,
  credentials: { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY },
});
const Bucket = config.S3_BUCKET;
// Signing is offline, so signed URLs can use an address the browser reaches (for example localhost) while the API itself talks to storage on the Docker network.
const signer = config.S3_PUBLIC_ENDPOINT
  ? new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_PUBLIC_ENDPOINT,
      forcePathStyle: true,
      credentials: { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY },
    })
  : s3;

export const signedPut = (Key: string, ContentType: string, ContentLength: number) =>
  getSignedUrl(signer, new PutObjectCommand({ Bucket, Key, ContentType, ContentLength }), { expiresIn: 600 });

// Downloads are always served as attachments so uploaded HTML/SVG/JS never executes on our origin.
export const signedGet = (Key: string, filename?: string) =>
  getSignedUrl(
    signer,
    new GetObjectCommand({ Bucket, Key, ...(filename ? { ResponseContentDisposition: `attachment; filename="${filename}"` } : {}) }),
    { expiresIn: 3600 }
  );

export const mediaUrl = (key: string) =>
  config.PUBLIC_MEDIA_BASE_URL ? Promise.resolve(`${config.PUBLIC_MEDIA_BASE_URL}/${key}`) : signedGet(key);

export async function head(Key: string) {
  try {
    const r = await s3.send(new HeadObjectCommand({ Bucket, Key }));
    return { size: r.ContentLength ?? 0 };
  } catch {
    return null;
  }
}

export async function remove(keys: string[]) {
  if (!keys.length) return;
  try {
    await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys.map((Key) => ({ Key })) } }));
  } catch (e) {
    console.error("storage delete failed", e);
  }
}

export async function getBytes(Key: string) {
  const r = await s3.send(new GetObjectCommand({ Bucket, Key }));
  return Buffer.from(await r.Body!.transformToByteArray());
}
