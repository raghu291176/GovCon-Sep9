// Approvals extraction and document type heuristics

export function extractApprovalsFromText(text) {
  const src = String(text || '');
  if (!src.trim()) return [];
  const lines = src.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const results = [];
  const seen = new Set();

  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'];
  function parseDate(s) {
    if (!s) return null;
    const str = String(s).trim();
    // ISO-like yyyy-mm-dd
    let m = str.match(/(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if (m) {
      const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
    // mm/dd/yyyy or dd/mm/yyyy (assume mm/dd unless day>12)
    m = str.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
    if (m) {
      let a = Number(m[1]), b = Number(m[2]), c = Number(m[3]);
      if (c < 100) c += 2000;
      let month = a, day = b;
      if (a > 12 && b <= 12) { month = b; day = a; }
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${c}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
    // Month dd, yyyy
    m = str.match(new RegExp(`(\\b(?:${months.join('|')})\\w*)\\.?\\s+(\\d{1,2}),\\s*(20\\d{2})`, 'i'));
    if (m) {
      const mon = m[1].toLowerCase().slice(0,3);
      const month = Math.max(1, months.findIndex(x => mon.startsWith(x)) + 1);
      const day = Number(m[2]); const y = Number(m[3]);
      if (month && day >= 1 && day <= 31) return `${y}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
    return null;
  }

  function push(a) {
    const key = [a.approver?.toLowerCase() || '', a.date || '', a.decision || ''].join('|');
    if (!seen.has(key)) { seen.add(key); results.push(a); }
  }

  const titleWords = ['manager','supervisor','director','vp','chief','officer','cfo','ceo','coo','cto','finance','hr','operations','program','project','approver','reviewer','auditor'];
  const decisionWords = [
    { re: /\b(approved|approval)\b/i, val: 'approved' },
    { re: /\b(denied|rejected|declined)\b/i, val: 'rejected' },
    { re: /\b(ok\s*to\s*pay|payment\s*approved)\b/i, val: 'approved' },
  ];

  function detectDecision(textLine) {
    for (const d of decisionWords) if (d.re.test(textLine)) return d.val;
    return 'unknown';
  }

  // Pass 1: single-line patterns
  const patterns = [
    /(approved|approval|authorized|authorised)\s*(?:by|:)?\s*([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,3})(?:\s*[,-]\s*([A-Za-z /&-]{2,50}))?(?:.*?\b(on|dated|date[: ]*)\s*(.+))?/i,
    /(reviewed|verified)\s*(?:by|:)?\s*([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,3})(?:\s*[,-]\s*([A-Za-z /&-]{2,50}))?(?:.*?\b(on|dated|date[: ]*)\s*(.+))?/i,
    /(authorized|authorised)\s*(?:by|:)?\s*([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,3})(?:\s*[,-]\s*([A-Za-z /&-]{2,50}))?(?:.*?\b(on|dated|date[: ]*)\s*(.+))?/i,
  ];

  for (const ln of lines) {
    for (const re of patterns) {
      const m = ln.match(re);
      if (m) {
        const approver = (m[2] || '').trim();
        const titleRaw = (m[3] || '').trim();
        const title = titleWords.some(w => titleRaw.toLowerCase().includes(w)) ? titleRaw : (titleRaw.length <= 2 ? '' : titleRaw);
        const date = parseDate(m[5] || '') || parseDate(ln) || null;
        const decision = detectDecision(ln);
        const conf = 0.6 + (date ? 0.2 : 0) + (title ? 0.1 : 0);
        const summary = [`${decision === 'rejected' ? 'Rejected' : 'Approved'} by ${approver}`, title ? `(${title})` : '', date ? `on ${date}` : ''].filter(Boolean).join(' ');
        push({ approver, title: title || undefined, date: date || undefined, decision, comments: undefined, targetType: undefined, summary, confidence: Math.min(0.95, conf) });
        break;
      }
    }
  }

  // Pass 2: multi-line blocks like "Approved by:\nName\nTitle\nDate: ..."
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^(approved|approval|reviewed|authorized|authorised)\b.*?:?$/i.test(ln)) {
      const block = [lines[i+1] || '', lines[i+2] || '', lines[i+3] || ''];
      const nameLine = block.find(s => /[A-Za-z][a-z]+\s+[A-Za-z.'-]+/.test(s)) || '';
      const titleLine = block.find(s => titleWords.some(w => s.toLowerCase().includes(w))) || '';
      const dateLine = block.find(s => /\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|20\d{2}-\d{1,2}-\d{1,2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+\d{1,2},\s*20\d{2})\b/i.test(s)) || '';
      const approver = (nameLine.match(/([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,3})/) || [,''])[1];
      const date = parseDate(dateLine) || parseDate(block.join(' '));
      const title = titleLine || undefined;
      const decision = detectDecision(ln);
      if (approver) {
        const conf = 0.5 + (date ? 0.2 : 0) + (title ? 0.1 : 0) + 0.1;
        const summary = [`${decision === 'rejected' ? 'Rejected' : 'Approved'} by ${approver}`, title ? `(${title})` : '', date ? `on ${date}` : ''].filter(Boolean).join(' ');
        push({ approver, title, date: date || undefined, decision, comments: undefined, targetType: undefined, summary, confidence: Math.min(0.95, conf) });
      }
    }
  }

  // Pass 3: generic decision-only hints
  for (const ln of lines) {
    if (/\bok\s*to\s*pay\b/i.test(ln)) {
      push({ decision: 'approved', summary: ln.slice(0,120), confidence: 0.4 });
    }
    if (/\b(payment\s*approved)\b/i.test(ln)) {
      push({ decision: 'approved', summary: ln.slice(0,120), confidence: 0.45 });
    }
    if (/\b(denied|rejected|declined)\b/i.test(ln)) {
      push({ decision: 'rejected', summary: ln.slice(0,120), confidence: 0.45 });
    }
  }

  return results;
}

export function classifyByText(text, filename) {
  const name = (filename || '').toLowerCase();
  const t = (text || '').toLowerCase();
  const hasAny = (...terms) => terms.some((w) => t.includes(w));
  // Extract structured approvals from text
  const approvals = extractApprovalsFromText(text || '');
  const looksLikeInvoice = name.includes('invoice') || hasAny('invoice #', 'invoice no', 'invoice number', 'bill to', 'invoice date');
  const looksLikeReceipt = name.includes('receipt') || hasAny('merchant', 'total', 'subtotal', 'sales tax', 'thank you for your purchase');
  const looksLikeTimesheet = name.includes('timesheet') || hasAny('timesheet', 'time sheet', 'hours worked', 'week ending', 'employee id', 'timesheet approval');
  const looksLikeOrgChart = name.includes('org') && name.includes('chart') || hasAny('org chart', 'organizational chart', 'organization chart', 'orgchart', 'org structure', 'reports to', 'hierarchy');
  let docType = 'unknown';
  if (looksLikeInvoice) docType = 'invoice';
  else if (looksLikeReceipt) docType = 'receipt';
  else if (looksLikeTimesheet) docType = 'timesheet';
  else if (looksLikeOrgChart) docType = 'org_chart';

  // Consider approval-heavy notes
  if (docType === 'unknown' && hasAny('approved', 'approval', 'approve', 'authorized', 'sign off', 'sign-off')) {
    let target = 'unknown';
    if (hasAny('invoice')) target = 'invoice';
    else if (hasAny('receipt', 'expense report')) target = 'receipt';
    else if (hasAny('timesheet', 'time sheet')) target = 'timesheet';
    approvals.push({ summary: 'Approval note detected', targetType: target, decision: 'approved', confidence: 0.4 });
    return { docType: 'approval_note', approvals };
  }
  return { docType, approvals };
}

