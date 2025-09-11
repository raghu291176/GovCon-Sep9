// Matching helpers for linking document items to GL entries

function normalizeVendor(s) {
  const t = String(s || '').toLowerCase();
  // Strip common words/suffixes and punctuation
  const cleaned = t
    .replace(/\.(com|net|org|io)\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|inc|llc|l\.?l\.?c\.?|corp|corporation|company|co|business|services|service|store|stores)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
}

export function scoreMatch(gl, item) {
  let score = 0;
  const amt = Number(item.amount || 0);
  const glAmt = Number(gl.amount || 0);
  const amountExact = Math.abs(amt - glAmt) < 0.01;
  const amountClose = !amountExact && Math.abs(amt - glAmt) <= 1.0;
  if (amountExact) score += 0.6; else if (amountClose) score += 0.45;

  // Vendor similarity with normalization
  const v1raw = String(item.vendor || '');
  const v2raw = String(gl.vendor || '');
  const v1 = normalizeVendor(v1raw);
  const v2 = normalizeVendor(v2raw);
  const vendorPresentBoth = !!(v1 && v2);
  const vendorMatch = vendorPresentBoth && (v1.includes(v2) || v2.includes(v1));
  if (vendorMatch) score += 0.25;

  // Date proximity
  const d1 = item.date ? new Date(item.date) : null;
  const d2 = gl.date ? new Date(gl.date) : null;
  let dateBonus = 0;
  let dateClose = false;
  if (d1 && d2) {
    const delta = Math.abs((d1 - d2) / (1000 * 60 * 60 * 24));
    if (delta <= 2) { dateBonus = 0.1; dateClose = true; }
    else if (delta <= 7) { dateBonus = 0.05; }
    score += dateBonus;
  }

  // Return score and flags for dynamic thresholding
  return { score, amountExact, dateClose, vendorPresentBoth, vendorMatch };
}

export function hasUnallowableKeyword(text) {
  const t = (text || '').toLowerCase();
  const bads = ['alcohol', 'wine', 'beer', 'spirits', 'liquor', 'cocktail', 'entertainment', 'gift', 'flowers', 'golf', 'country club'];
  return bads.some(k => t.includes(k));
}
