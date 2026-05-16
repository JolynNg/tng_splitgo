/**
 * Item categorisation — second AI pass on the OCR results.
 *
 * After receipt OCR extracts the items, we ask the AWS backend to label each one
 * (Mains / Drinks / Sides / Dessert / Other) so the Items screen can render
 * coloured category chips. Pure UX polish — does NOT affect totals.
 *
 * Endpoint:  AWS API Gateway → Lambda → Qwen-Plus
 *
 * Returns: { [itemId]: 'mains' | 'drinks' | 'sides' | 'dessert' | 'other' }
 */

const AWS_API_URL = process.env.EXPO_PUBLIC_AWS_API_URL;

export async function categorizeItems(items) {
  if (!AWS_API_URL || !items?.length) return {};

  const resp = await fetch(`${AWS_API_URL.replace(/\/$/, '')}/ai/categorize-items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });

  if (!resp.ok) {
    throw new Error(`Categorise failed (${resp.status})`);
  }
  const data = await resp.json();
  return data.categories || {};
}
