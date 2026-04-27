/**
 * Receipt photo upload — two-step:
 *   1. Ask Lambda for a short-lived pre-signed S3 PUT URL.
 *   2. PUT the JPEG bytes directly to S3 from the device.
 *
 * Lets the receipt image live in AWS S3 alongside the bill record in DynamoDB,
 * so the bill is fully reproducible (and we never proxy big binaries through Lambda).
 *
 * Caller usage:
 *   const { key, getUrl } = await uploadReceipt(base64);
 *   // store `key` on the bill via createBill({ receiptKey: key })
 *   // `getUrl` is a 1h pre-signed GET URL safe to render in <Image>.
 *
 * If EXPO_PUBLIC_AWS_API_URL is not set, returns null (silent no-op for offline demos).
 */

const AWS_API_URL = process.env.EXPO_PUBLIC_AWS_API_URL;

export async function uploadReceipt(base64, opts = {}) {
  if (!AWS_API_URL) return null;
  if (!base64) return null;

  const ext         = opts.ext || 'jpg';
  const contentType = opts.contentType || 'image/jpeg';

  // 1. Get a pre-signed URL from Lambda
  const apiBase = AWS_API_URL.replace(/\/$/, '');
  let presignRes;
  try {
    presignRes = await fetch(`${apiBase}/upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ext, contentType }),
    });
  } catch (e) {
    const msg = e?.message || String(e);
    if (/network request failed/i.test(msg)) {
      throw new Error(
        `${msg} — cannot reach ${apiBase} for upload-url. Re-run \`cd infra && ./deploy.sh\`, then \`npx expo start --clear\`.`,
      );
    }
    throw e;
  }
  if (!presignRes.ok) {
    throw new Error(`Could not get upload URL (${presignRes.status})`);
  }
  const { uploadUrl, key, getUrl, publicUrl } = await presignRes.json();

  // 2. Convert base64 → Blob and PUT to S3
  const dataUrl = `data:${contentType};base64,${base64}`;
  const blob    = await fetch(dataUrl).then(r => r.blob());

  let putRes;
  try {
    putRes = await fetch(uploadUrl, {
      method:  'PUT',
      headers: { 'Content-Type': contentType },
      body:    blob,
    });
  } catch (e) {
    const msg = e?.message || String(e);
    if (/network request failed/i.test(msg)) {
      throw new Error(
        `${msg} — S3 upload could not connect (check device network / VPN; bucket region must match your deploy).`,
      );
    }
    throw e;
  }
  if (!putRes.ok) {
    throw new Error(`S3 upload failed (${putRes.status})`);
  }

  return { key, getUrl, publicUrl };
}
