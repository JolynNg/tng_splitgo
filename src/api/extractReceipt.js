/**
 * Receipt OCR — runs through the AWS backend using Qwen-VL-Max.
 *
 * Required env: EXPO_PUBLIC_AWS_API_URL
 *
 * Returns:
 *   { restaurant, date, items: [{id, name, qty, unit}], sst, serviceCharge }
 *
 * SECURITY: the model call stays server-side in Lambda. The app only sends
 * the compressed receipt image to API Gateway.
 */

const AWS_API_URL = process.env.EXPO_PUBLIC_AWS_API_URL;

export async function extractReceiptItems(base64Image) {
  if (!AWS_API_URL) {
    throw new Error(
      'Missing EXPO_PUBLIC_AWS_API_URL.\n\n' +
      'Run `cd infra && ./deploy.sh`, then restart Metro with `CI=false npx expo start --clear`.'
    );
  }

  const response = await fetch(`${AWS_API_URL.replace(/\/$/, '')}/ai/extract-receipt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageBase64: base64Image,
      mimeType: 'image/jpeg',
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`AWS OCR error ${response.status}: ${err}`);
  }

  return response.json();
}

export const OCR_PROVIDER = AWS_API_URL
  ? 'AWS Lambda · Qwen-VL-Max'
  : 'not configured';
