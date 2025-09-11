function classify(text) {
  const t = (text || '').toLowerCase();
  const has = (...ws) => ws.some((w) => t.includes(w));
  if (has('invoice', 'bill to', 'balance due', 'invoice #', 'invoice no', 'invoice number')) return 'invoice';
  if (has('receipt', 'subtotal', 'sales tax', 'thank you for your purchase', 'change due', 'merchant')) return 'receipt';
  if (has('timesheet', 'time sheet', 'week ending', 'hours worked', 'employee id')) return 'timesheet';
  if (has('approved by', 'approval', 'approver', 'authorized by', 'sign-off', 'sign off')) return 'approval';
  if (has('org chart', 'organizational chart', 'organization chart', 'reports to', 'hierarchy')) return 'orgchart';
  return 'other';
}

module.exports = { classify };

