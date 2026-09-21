import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";

let client: S3Client | undefined;

function s3() {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${env.r2.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.r2.accessKeyId,
        secretAccessKey: env.r2.secretAccessKey,
      },
    });
  }
  return client;
}

export async function putObject(key: string, body: Uint8Array, contentType: string) {
  await s3().send(
    new PutObjectCommand({
      Bucket: env.r2.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return key;
}

export async function getObject(key: string) {
  const result = await s3().send(new GetObjectCommand({ Bucket: env.r2.bucket, Key: key }));
  return result;
}

/** Short-lived direct download link, so large files never pass through Next.js. */
export async function signedDownloadUrl(key: string, filename: string, expiresIn = 300) {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: env.r2.bucket,
      Key: key,
      // Control characters would let a filename write its own headers into
      // the response.
      // biome-ignore lint/suspicious/noControlCharactersInRegex: that is the point
      ResponseContentDisposition: `attachment; filename="${filename.replace(/["\\\x00-\x1f\x7f]/g, "")}"`,
    }),
    { expiresIn },
  );
}
