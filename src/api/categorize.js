/**
 * Item categorisation — second AI pass on the OCR results.
 *
 * After Qwen-VL extracts the items, we ask Qwen-Plus to label each one
 * (Mains / Drinks / Sides / Dessert / Other) so the Items screen can render
 * coloured category chips. Pure UX polish — does NOT affect totals.
 *
 * Endpoint:  Alibaba Cloud Model Studio (DashScope) compatible-mode
 * Model:     qwen-plus
 *
 * Returns: { [itemId]: 'mains' | 'drinks' | 'sides' | 'dessert' | 'other' }
 */

const ALIBABA_API_KEY = process.env.EXPO_PUBLIC_DASHSCOPE_API_KEY;
const ALIBABA_ENDPOINT = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';

const VALID_CATEGORIES = ['mains', 'drinks', 'sides', 'dessert', 'other'];

const PROMPT = `Categorise each food/drink item into one of: mains, drinks, sides, dessert, other.

Rules:
- "mains"   = main meals e.g. nasi lemak, char kuey teow, burger, rendang, pasta
- "drinks"  = anything to drink e.g. teh tarik, kopi, milo ais, soft drink, juice, water
- "sides"   = appetisers, sides, snacks e.g. roti, fries, sambal, kerabu, salad
- "dessert" = sweet stuff e.g. cendol, ais kacang, cake, ice cream
- "other"   = anything that doesn't fit (e.g. condiments, packaging fees)

Output ONLY a JSON array of strings (one per input item, in order). No keys, no explanations.
Example input:  ["Nasi Lemak", "Teh Tarik", "Roti Canai"]
Example output: ["mains", "drinks", "sides"]`;

export async function categorizeItems(items) {
  if (!ALIBABA_API_KEY || !items?.length) return {};

  const names = items.map(it => it.name);
  const resp = await fetch(ALIBABA_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ALIBABA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'qwen-plus',
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user',   content: JSON.stringify(names) },
      ],
    }),
  });

  if (!resp.ok) {
    throw new Error(`Categorise failed (${resp.status})`);
  }
  const data = await resp.json();
  const raw  = data.choices?.[0]?.message?.content || '[]';
  const clean = raw.trim().replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim();

  let arr;
  try { arr = JSON.parse(clean); }
  catch { return {}; }
  if (!Array.isArray(arr)) return {};

  const out = {};
  items.forEach((it, i) => {
    const cat = String(arr[i] || 'other').toLowerCase();
    out[it.id] = VALID_CATEGORIES.includes(cat) ? cat : 'other';
  });
  return out;
}
