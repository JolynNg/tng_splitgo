const AWS_API_URL = process.env.EXPO_PUBLIC_AWS_API_URL;

/**
 * FX policy:
 *   1. Try AWS backend (which has its own FX provider chain).
 *   2. If unreachable / not deployed, fall back to public FX providers
 *      directly from the device.
 *   3. Provider chain (each is no-API-key):
 *        a) Historical: frankfurter.app at receipt date
 *        b) Today:      frankfurter.app latest
 *        c) Today:      open.er-api.com (mirror, totally different host)
 *   4. If all providers fail, throw — we explicitly do NOT silently use a
 *      1:1 rate, because that would render foreign amounts as "RM x" with
 *      no conversion (which is the bug this file exists to prevent).
 */

function parseDateToISO(raw) {
  if (!raw) return new Date().toISOString().slice(0, 10);
  const s = String(raw).trim();
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const dd = String(parseInt(m[1], 10)).padStart(2, '0');
    const mm = String(parseInt(m[2], 10)).padStart(2, '0');
    const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  return new Date().toISOString().slice(0, 10);
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

async function fetchFxRateDirect(sourceCurrency, date) {
  const from = String(sourceCurrency || 'MYR').toUpperCase();
  if (from === 'MYR') return { rate: 1, fxDate: parseDateToISO(date), source: 'noop' };
  const day = parseDateToISO(date);

  // 1) Frankfurter — historical
  try {
    const j = await fetchJson(`https://api.frankfurter.dev/v1/${day}?from=${encodeURIComponent(from)}&to=MYR`);
    const rate = Number(j?.rates?.MYR);
    if (Number.isFinite(rate) && rate > 0) {
      return { rate, fxDate: day, source: 'frankfurter:historical' };
    }
  } catch (e) {
    console.warn('[fx] frankfurter historical failed:', e?.message || e);
  }

  // 2) Frankfurter — latest (today's rate)
  try {
    const j2 = await fetchJson(`https://api.frankfurter.dev/v1/latest?from=${encodeURIComponent(from)}&to=MYR`);
    const rate2 = Number(j2?.rates?.MYR);
    if (Number.isFinite(rate2) && rate2 > 0) {
      return { rate: rate2, fxDate: day, source: 'frankfurter:latest' };
    }
  } catch (e) {
    console.warn('[fx] frankfurter latest failed:', e?.message || e);
  }

  // 3) open.er-api.com — latest (mirror, different host so survives single-provider outages)
  try {
    const j3 = await fetchJson(`https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`);
    const rate3 = Number(j3?.rates?.MYR);
    if (Number.isFinite(rate3) && rate3 > 0) {
      return { rate: rate3, fxDate: day, source: 'erapi:latest' };
    }
  } catch (e) {
    console.warn('[fx] er-api latest failed:', e?.message || e);
  }

  throw new Error(`FX rate unavailable for ${from}->MYR (tried historical and today's rate from multiple providers).`);
}

export async function convertAmountsToMyr({ currency, date, amounts }) {
  const sourceCurrency = String(currency || 'MYR').toUpperCase();
  const arr = Array.isArray(amounts) ? amounts : [];
  if (sourceCurrency === 'MYR' || arr.length === 0) {
    return {
      sourceCurrency,
      targetCurrency: 'MYR',
      fxRateToMyr: 1,
      fxDate: parseDateToISO(date),
      amountsMyr: arr.map((n) => +(Number(n) || 0).toFixed(2)),
      local: true,
    };
  }

  if (AWS_API_URL) {
    const base = AWS_API_URL.replace(/\/$/, '');
    try {
      const r = await fetch(`${base}/fx/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currency: sourceCurrency, date, amounts: arr }),
      });
      if (r.ok) {
        const j = await r.json();
        if (Number(j?.fxRateToMyr) > 0 && j.fxRateToMyr !== 1) {
          return j;
        }
      }
    } catch {
      // Fall through to direct fetch below.
    }
  }

  const { rate, fxDate } = await fetchFxRateDirect(sourceCurrency, date);
  return {
    sourceCurrency,
    targetCurrency: 'MYR',
    fxRateToMyr: rate,
    fxDate,
    amountsMyr: arr.map((n) => +((Number(n) || 0) * rate).toFixed(2)),
    local: true,
  };
}
