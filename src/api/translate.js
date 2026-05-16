/**
 * Item-name translation via AWS Lambda + Qwen-Plus.
 *
 * Powers the multilingual toggle on the Items screen so a Bahasa Malaysia
 * receipt can be re-shown in English (or vice versa) for international users
 * — useful for tourist scenarios in SEA.
 *
 * Input:  items (array of {id, name}), targetLang ('en' | 'ms' | 'zh')
 * Output: { [itemId]: translatedName }
 */

const AWS_API_URL = process.env.EXPO_PUBLIC_AWS_API_URL;

const LANG_LABEL = {
  en: 'English',
  ms: 'Bahasa Malaysia',
  zh: 'Simplified Chinese',
};

export async function translateItems(items, targetLang) {
  if (!AWS_API_URL || !items?.length || !LANG_LABEL[targetLang]) return {};

  const resp = await fetch(`${AWS_API_URL.replace(/\/$/, '')}/ai/translate-items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, targetLang }),
  });

  if (!resp.ok) throw new Error(`Translate failed (${resp.status})`);
  const data = await resp.json();
  return data.translations || {};
}

export const SUPPORTED_LANGS = [
  { code: 'en', label: 'EN', flag: '🇬🇧', name: 'English' },
  { code: 'ms', label: 'BM', flag: '🇲🇾', name: 'Malay' },
  { code: 'zh', label: '中文', flag: '🇨🇳', name: '中文' },
];
