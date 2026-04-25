/**
 * Receipt OCR — runs on Alibaba Cloud Model Studio (DashScope).
 *
 * Model:        qwen-vl-max  (multimodal vision + text, strong on Bahasa,
 *                              English and Chinese receipts in SEA region)
 * Endpoint:     https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions
 *               (use dashscope.aliyuncs.com — drop the "-intl" — for
 *                mainland-China-registered accounts)
 * Required env: EXPO_PUBLIC_DASHSCOPE_API_KEY
 *
 * Returns:
 *   { restaurant, date, items: [{id, name, qty, unit}], sst, serviceCharge }
 *
 * SECURITY: shipping the API key to the client is acceptable for a hackathon
 * demo. For production this call should be proxied through the AWS Lambda
 * backend so the key never leaves the server.
 */

const ALIBABA_API_KEY = process.env.EXPO_PUBLIC_DASHSCOPE_API_KEY;

const ALIBABA_ENDPOINT = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';
const ALIBABA_MODEL = 'qwen-vl-max';

const PROMPT = `You are a careful receipt-parsing expert. The image is a real-world restaurant
receipt — it can be printed thermal paper, a handwritten cash bill on a
pre-printed bilingual template (English/Chinese/Malay), or a mix of both.
Read it the way a human would: look at every row, work out which rows are
actual ordered items vs. headers/totals/empty template rows, and compute
exact totals from what is *written*, not what you assume.

STEP 1 — Reason briefly (≤ 8 short lines, no prose):
  • One line for restaurant + language + layout.
  • One line per actual item row: <name>  qty=<n>  lineTotal=<n>
    Combine pre-printed category labels with the handwritten dish next to
    them when relevant. Example: a row pre-printed "Fish" with handwritten
    "潮州蒸金凤  40" → "Fish · 潮州蒸金凤  qty=1  lineTotal=40".
    Do NOT list empty pre-printed category rows.
  • One line for the math check: sum of all lineTotals must equal the
    printed subtotal (or grand total - service charge - SST). If it's off,
    fix the row that's wrong before producing the JSON below.

STEP 2 — Output a single JSON object, on its own, after a line containing
just \`---JSON---\`. No markdown fences. The JSON must have this exact shape:

{
  "restaurant": "string or null",
  "date": "string formatted 'D MMM YYYY, HH:MM' or null if not printed",
  "currency": "MYR | SGD | THB | IDR | USD | EUR | CNY",
  "items": [
    { "id": 1, "name": "string", "qty": number, "lineTotal": number }
  ],
  "sst": number or null,
  "serviceCharge": number or null
}

Hard rules for items[]:
  • Include every dish, drink, side, or take-away charge that has a price
    written next to it. Skip rows that are only a pre-printed category
    label with no handwritten dish or no price (e.g. an empty "Beer" row).
  • "qty": the number of units. Look for "x2", "2pcs", "×3", a numeral in
    a quantity column, or the word "set". If absent, use 1.
  • "lineTotal": the price PRINTED ON THAT ROW for the whole line — i.e.
    the total for all units of that item as written. Do NOT multiply by
    qty, do NOT divide by qty. Example: "Tiger Beer  2  27.00" → qty=2,
    lineTotal=27.00. Example: "汽水 x3  6" → qty=3, lineTotal=6.
  • Use the dish name as written. If only Chinese is handwritten, include
    the Chinese characters. If both English category and Chinese dish are
    present, format as "English · Chinese".
  • Do NOT include SST, service charge, subtotal, take-away packaging
    surcharge totals, or grand total as items.

Currency inference:
  RM / MYR → "MYR"   |   S$ / SGD → "SGD"   |   ฿ / THB → "THB"
  Rp / IDR → "IDR"   |   $ / USD → "USD"    |   € / EUR → "EUR"
  ¥ / RMB / CNY → "CNY".  Default "MYR" if no symbol is visible.

If the receipt is unreadable, still emit the marker line and the JSON:
  {"restaurant":null,"date":null,"currency":"MYR","items":[],"sst":null,"serviceCharge":null}`;

/**
 * Parse the model's response, which may be (a) pure JSON, (b) JSON in a
 * markdown fence, or (c) a chain-of-thought explanation followed by a
 * `---JSON---` marker and then the JSON object. We grab the *last* balanced
 * `{...}` block we can find, which is the most reliable strategy when the
 * model decides to think out loud first.
 */
function parseJsonResponse(rawText) {
  const text = (rawText || '').trim();
  if (!text) return JSON.parse('{}');

  // Honour explicit marker if the model used it.
  const marked = text.split(/-{3,}\s*JSON\s*-{3,}/i).pop().trim();
  const candidates = [
    marked,
    text.replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim(),
    text,
  ];

  for (const c of candidates) {
    const start = c.indexOf('{');
    const end   = c.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) continue;
    const slice = c.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch {
      // try the next candidate
    }
  }
  throw new Error('Receipt parser: could not find JSON in model response.');
}

const SUPPORTED_CURRENCIES = ['MYR', 'SGD', 'THB', 'IDR', 'USD', 'EUR', 'CNY'];

function normalizeResult(parsed) {
  if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
    throw new Error('No items could be extracted from the receipt.');
  }
  const ccyRaw = (parsed.currency || 'MYR').toString().toUpperCase().trim();
  const currency = SUPPORTED_CURRENCIES.includes(ccyRaw) ? ccyRaw : 'MYR';

  // The rest of the app uses `unit` and computes line total as `qty * unit`.
  // The model now returns `lineTotal` (the printed price, unambiguous on
  // receipts), so we derive `unit = lineTotal / qty` here. Fall back to a
  // `unit`-shaped response for backward compatibility.
  const items = parsed.items.map((it, idx) => {
    const qty = Number(it.qty) || 1;
    let unit;
    if (typeof it.lineTotal === 'number') {
      unit = qty > 0 ? +(it.lineTotal / qty).toFixed(4) : it.lineTotal;
    } else if (typeof it.unit === 'number') {
      unit = it.unit;
    } else {
      unit = 0;
    }
    return {
      id:   typeof it.id === 'number' ? it.id : idx + 1,
      name: it.name || '',
      qty,
      unit,
    };
  });

  return {
    restaurant: parsed.restaurant ?? null,
    date: typeof parsed.date === 'string' ? parsed.date : null,
    currency,
    items,
    sst: typeof parsed.sst === 'number' ? parsed.sst : null,
    serviceCharge: typeof parsed.serviceCharge === 'number' ? parsed.serviceCharge : null,
  };
}

export async function extractReceiptItems(base64Image) {
  if (!ALIBABA_API_KEY) {
    throw new Error(
      'Missing EXPO_PUBLIC_DASHSCOPE_API_KEY.\n\n' +
      'Sign up at alibabacloud.com → activate Model Studio → create an API key, ' +
      'then add it to your .env file:\n' +
      'EXPO_PUBLIC_DASHSCOPE_API_KEY=sk-xxxxxxxxxxxxxxxx\n\n' +
      'Then restart Metro with `CI=false npx expo start --clear`.'
    );
  }

  const response = await fetch(ALIBABA_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ALIBABA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ALIBABA_MODEL,
      // Deterministic + capped tokens. We still want the model to think a bit
      // for messy/handwritten bills, but a tighter ceiling cuts ~3-5s off the
      // generation phase without hurting accuracy on the receipts we tested.
      temperature: 0,
      top_p: 0.1,
      max_tokens: 1024,
      // Qwen-VL-specific flag: tells DashScope to keep the image at its
      // native resolution (instead of downsampling to ~1024px). Critical for
      // handwritten / mixed-language receipts where small numbers matter.
      vl_high_resolution_images: true,
      messages: [
        {
          role: 'system',
          content: 'You are a meticulous OCR + data-extraction expert for restaurant receipts in Southeast Asia. You are equally comfortable with thermal-printed bills and handwritten cash bills in English, Bahasa Malaysia, and Chinese.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${base64Image}` },
            },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Alibaba Qwen-VL error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content ?? '{}';
  const text = typeof raw === 'string' ? raw : raw[0]?.text || '{}';
  return normalizeResult(parseJsonResponse(text));
}

export const OCR_PROVIDER = ALIBABA_API_KEY
  ? 'Alibaba Cloud · Qwen-VL-Max'
  : 'not configured';
