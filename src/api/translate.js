/**
 * Item-name translation via Qwen-Plus.
 *
 * Powers the multilingual toggle on the Items screen so a Bahasa Malaysia
 * receipt can be re-shown in English (or vice versa) for international users
 * — useful for tourist scenarios in SEA.
 *
 * Endpoint:  Alibaba Cloud Model Studio (DashScope) compatible-mode
 * Model:     qwen-plus
 *
 * Input:  items (array of {id, name}), targetLang ('en' | 'ms' | 'zh')
 * Output: { [itemId]: translatedName }
 */

const ALIBABA_API_KEY = process.env.EXPO_PUBLIC_DASHSCOPE_API_KEY;
const ALIBABA_ENDPOINT = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';

const LANG_LABEL = {
  en: 'English',
  ms: 'Bahasa Malaysia',
  zh: 'Simplified Chinese',
};

export async function translateItems(items, targetLang) {
  if (!ALIBABA_API_KEY || !items?.length || !LANG_LABEL[targetLang]) return {};

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
        {
          role: 'system',
          content: `Translate each food/drink item name to ${LANG_LABEL[targetLang]}. Keep it short and natural. Preserve well-known proper names (e.g. "Nasi Lemak" stays "Nasi Lemak" in English). Output ONLY a JSON array of strings, one per input item, in the same order.`,
        },
        { role: 'user', content: JSON.stringify(names) },
      ],
    }),
  });

  if (!resp.ok) throw new Error(`Translate failed (${resp.status})`);
  const data  = await resp.json();
  const raw   = data.choices?.[0]?.message?.content || '[]';
  const clean = raw.trim().replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim();

  let arr;
  try { arr = JSON.parse(clean); }
  catch { return {}; }
  if (!Array.isArray(arr)) return {};

  const out = {};
  items.forEach((it, i) => {
    const t = arr[i];
    if (typeof t === 'string' && t.trim()) out[it.id] = t.trim();
  });
  return out;
}

export const SUPPORTED_LANGS = [
  { code: 'en', label: 'EN', flag: '🇬🇧', name: 'English' },
  { code: 'ms', label: 'BM', flag: '🇲🇾', name: 'Malay' },
  { code: 'zh', label: '中文', flag: '🇨🇳', name: '中文' },
];
