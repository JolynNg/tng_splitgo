const ANTHROPIC_API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;

const PROMPT = `You are a receipt OCR assistant. Analyse this receipt image and extract the following.

Return ONLY a single valid JSON object — no markdown, no explanation — with this exact shape:
{
  "restaurant": "string (name of the restaurant/shop, or null if unreadable)",
  "date": "string (date and time printed on the receipt, formatted as 'D MMM YYYY, HH:MM' e.g. '20 Apr 2026, 22:41', or null if not found)",
  "items": [
    { "id": 1, "name": "string", "qty": number, "unit": number }
  ],
  "sst": number or null,
  "serviceCharge": number or null
}

Rules:
- "items": every line-item food/drink ordered. "unit" is the price per single unit in RM (2 dp). Do NOT include SST, service charge, subtotal, or total as items.
- "sst": the SST / GST / tax amount shown on the receipt in RM. null if not present.
- "serviceCharge": the service charge amount shown on the receipt in RM. null if not present.
- "date": extract the transaction date/time from the receipt. null if not present.
- If you cannot read the receipt clearly return: {"restaurant":null,"date":null,"items":[],"sst":null,"serviceCharge":null}`;

export async function extractReceiptItems(base64Image) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error(
      'Missing EXPO_PUBLIC_ANTHROPIC_API_KEY. Add it to a local .env file before scanning receipts.'
    );
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: base64Image },
            },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const raw = data.content?.[0]?.text?.trim() ?? '{}';
  const clean = raw.replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim();
  const parsed = JSON.parse(clean);

  if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
    throw new Error('No items could be extracted from the receipt.');
  }

  return {
    restaurant: parsed.restaurant ?? null,
    date: typeof parsed.date === 'string' ? parsed.date : null,
    items: parsed.items,
    sst: typeof parsed.sst === 'number' ? parsed.sst : null,
    serviceCharge: typeof parsed.serviceCharge === 'number' ? parsed.serviceCharge : null,
  };
}
