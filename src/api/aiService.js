/**
 * AI text generation — runs server-side on AWS Lambda using Qwen-Plus.
 *
 *     RN app  ──►  AWS API Gateway  ──►  AWS Lambda  ──►  Qwen-Plus
 *
 * Endpoint: POST /ai/summary  body: { billId }
 * Returns:  { billId, message: string, model: string }
 */

const AWS_API_URL = process.env.EXPO_PUBLIC_AWS_API_URL;

export async function generateBillSummary(billId) {
  if (!AWS_API_URL) {
    throw new Error('AWS backend not configured. Set EXPO_PUBLIC_AWS_API_URL in .env.');
  }
  if (!billId) {
    throw new Error('Cannot generate summary — bill not yet saved to the cloud.');
  }
  const url = `${AWS_API_URL.replace(/\/$/, '')}/ai/summary`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ billId }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`AI summary failed (${r.status}): ${text.slice(0, 200)}`);
  }
  return r.json();
}
