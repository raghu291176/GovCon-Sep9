// Excel processing helpers (XLSX is provided globally by CDN)

export function readExcelFile(file) {
  return new Promise((resolve, reject) => {
    // Better XLSX detection with timeout
    const checkXLSX = (attempts = 0) => {
      if (typeof XLSX !== 'undefined') {
        processFile();
        return;
      }
      if (attempts < 10) { // 5 seconds total
        setTimeout(() => checkXLSX(attempts + 1), 500);
      } else {
        reject(new Error(`
          Excel library (XLSX) not loaded. Please:
          1. Check your internet connection
          2. Refresh the page
          3. Try again in a few moments
          
          If the problem persists, the CDN may be unavailable.
        `));
      }
    };

    const processFile = () => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          console.log('Processing Excel file...');
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: "array" });
          if (!workbook.SheetNames || !workbook.SheetNames.length) {
            throw new Error('No worksheets found in Excel file');
          }
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
          console.log(`✅ Excel processed: ${jsonData.length} rows`);
          resolve(jsonData);
        } catch (err) {
          reject(new Error(`Excel processing failed: ${err.message}`));
        }
      };
      reader.onerror = () => reject(new Error('File reading failed'));
      reader.readAsArrayBuffer(file);
    };

    checkXLSX();
  });
}

export function readExcelAsAOA(file) {
  return new Promise((resolve, reject) => {
    if (typeof XLSX === 'undefined') {
      reject(new Error('XLSX library not loaded. Please ensure you are online and the page can access cdnjs.'));
      return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: true });
        resolve(aoa);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function hasLetters(s) {
  return /[A-Za-z]/.test(String(s || ''));
}

function normKey(k) {
  return String(k || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseNumber(val) {
  if (val == null) return 0;
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  let s = String(val).trim();
  if (s === "" || s.toLowerCase() === "na" || s.toLowerCase() === "n/a") return 0;
  // Handle parentheses negatives and remove currency/commas
  let negative = false;
  if (/^\(.+\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/[^0-9.\-]/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

function firstByKeys(row, candidates) {
  // Build normalized map once per row
  const map = new Map();
  for (const key in row) {
    map.set(normKey(key), row[key]);
  }
  for (const k of candidates) {
    const v = map.get(normKey(k));
    if (v !== undefined) return v;
  }
  return undefined;
}

export function mapExcelRows(jsonData) {
  const amountKeys = [
    'amount', 'amount$', 'amountusd', 'total', 'totalamount', 'lineamount', 'extendedamount',
    'netamount', 'grossamount', 'amt', 'value', 'transactionamount', 'amountus$', 'amount($)'
  ];
  const debitKeys = ['debit', 'debits', 'dr'];
  const creditKeys = ['credit', 'credits', 'cr'];
  const accountKeys = ['account number', 'account', 'account no', 'acct', 'acct number', 'gl account', 'glaccount'];
  const descriptionKeys = ['description', 'memo', 'details', 'detail', 'item description', 'narration'];
  const dateKeys = ['date', 'posting date', 'txn date', 'transaction date', 'post date'];
  const categoryKeys = ['category', 'gl category', 'account type', 'type', 'expense type'];
  const vendorKeys = ['vendor', 'vendor name', 'supplier', 'payee'];
  const contractKeys = ['contract number', 'contract', 'contract #', 'contract#', 'contractno'];

  return (jsonData || []).map((row, index) => {
    // Find amount
    let amount = 0;
    let rawAmount = firstByKeys(row, amountKeys);
    if (rawAmount === undefined) {
      const debit = parseNumber(firstByKeys(row, debitKeys));
      const credit = parseNumber(firstByKeys(row, creditKeys));
      if (debit !== 0 || credit !== 0) {
        // Treat debit as positive, credit as negative
        amount = debit - credit;
      }
    } else {
      amount = parseNumber(rawAmount);
      // Fallback: if still zero, scan row for first currency-like numeric
      if (amount === 0) {
        for (const k in row) {
          const v = row[k];
          const n = parseNumber(v);
          if (n !== 0) { amount = n; break; }
        }
      }
    }

    const dateVal = firstByKeys(row, dateKeys) || '';
    let date = dateVal;
    // If number (Excel serial), convert roughly to ISO date
    if (typeof dateVal === 'number' && Number.isFinite(dateVal)) {
      const epoch = new Date(Date.UTC(1899, 11, 30)); // Excel epoch
      const d = new Date(epoch.getTime() + dateVal * 86400000);
      date = d.toISOString().slice(0, 10);
    }

    return {
      id: index,
      accountNumber: firstByKeys(row, accountKeys) || '',
      description: firstByKeys(row, descriptionKeys) || '',
      amount,
      date,
      category: firstByKeys(row, categoryKeys) || '',
      vendor: firstByKeys(row, vendorKeys) || '',
      contractNumber: firstByKeys(row, contractKeys) || '',
    };
  });
}

export function mapRowsFromAOA(aoa, mapping, headerRowIndex = 0) {
  if (!Array.isArray(aoa) || aoa.length === 0) return [];
  const rows = [];
  const hIdx = Math.max(0, Number(headerRowIndex) || 0);
  const headers = (aoa[hIdx] || []).map((h) => String(h || ''));
  const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function findIndex(sel) {
    if (typeof sel === 'number') return sel;
    const key = normalize(sel);
    for (let i = 0; i < headers.length; i++) {
      if (normalize(headers[i]) === key) return i;
    }
    return -1;
  }
  const idx = {
    account: findIndex(mapping.accountNumber),
    description: findIndex(mapping.description),
    amount: findIndex(mapping.amount),
    date: findIndex(mapping.date),
    category: findIndex(mapping.category),
    vendor: findIndex(mapping.vendor),
    contract: findIndex(mapping.contractNumber),
    debit: findIndex(mapping.debit),
    credit: findIndex(mapping.credit),
  };
  for (let r = hIdx + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const amountVal = idx.amount >= 0 ? row[idx.amount] : undefined;
    const debitVal = idx.debit >= 0 ? row[idx.debit] : undefined;
    const creditVal = idx.credit >= 0 ? row[idx.credit] : undefined;
    let amount = 0;
    if (amountVal !== undefined) amount = parseNumber(amountVal);
    else if (debitVal !== undefined || creditVal !== undefined) {
      amount = parseNumber(debitVal) - parseNumber(creditVal);
    } else {
      // Fallback: scan the row for a numeric-looking cell
      for (const cell of row) {
        const n = parseNumber(cell);
        if (n !== 0) { amount = n; break; }
      }
    }
    let date = '';
    const dateVal = idx.date >= 0 ? row[idx.date] : '';
    if (typeof dateVal === 'number' && Number.isFinite(dateVal)) {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      date = new Date(epoch.getTime() + dateVal * 86400000).toISOString().slice(0, 10);
    } else {
      date = dateVal ? String(dateVal) : '';
    }
    rows.push({
      id: r - (hIdx + 1),
      accountNumber: idx.account >= 0 ? String(row[idx.account] || '') : '',
      description: idx.description >= 0 ? String(row[idx.description] || '') : '',
      amount,
      date,
      category: idx.category >= 0 ? String(row[idx.category] || '') : '',
      vendor: idx.vendor >= 0 ? String(row[idx.vendor] || '') : '',
      contractNumber: idx.contract >= 0 ? String(row[idx.contract] || '') : '',
    });
  }
  return rows;
}

// Heuristic header row detection: scans early rows and scores for header-likeness
export function detectHeaderRow(aoa, maxScanRows = 15) {
  try {
    if (!Array.isArray(aoa) || aoa.length === 0) return 0;
    const amountKeys = [
      'amount','amount$','amountusd','total','totalamount','lineamount','extendedamount','netamount','grossamount','amt','transactionamount','amountus$','amount($)'
    ];
    const debitKeys = ['debit','debits','dr'];
    const creditKeys = ['credit','credits','cr'];
    const accountKeys = ['account number','account','account no','acct','acct number','gl account','glaccount'];
    const descriptionKeys = ['description','memo','details','detail','item description','narration'];
    const dateKeys = ['date','posting date','txn date','transaction date','post date'];
    const categoryKeys = ['category','gl category','account type','type','expense type'];
    const vendorKeys = ['vendor','vendor name','supplier','payee'];
    const contractKeys = ['contract number','contract','contract #','contract#','contractno'];
    const allSyn = new Set([
      ...amountKeys, ...debitKeys, ...creditKeys, ...accountKeys, ...descriptionKeys,
      ...dateKeys, ...categoryKeys, ...vendorKeys, ...contractKeys
    ].map(normKey));

    const limit = Math.min(aoa.length, Math.max(5, maxScanRows));
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let r = 0; r < limit; r++) {
      const row = aoa[r] || [];
      const nonEmpty = row.filter(v => v != null && String(v).trim() !== '').length;
      if (nonEmpty < 3) continue;
      let score = 0;
      for (const cell of row) {
        const s = String(cell || '').trim();
        if (!s) continue;
        const n = normKey(s);
        if (allSyn.has(n)) score += 3; // exact synonym match
        if (hasLetters(s)) score += 1; // header-like (textual)
        if (/\b(amount|total|date|vendor|account|description|category|contract)\b/i.test(s)) score += 2;
      }
      // Penalize rows that look numeric-only
      const numericish = row.filter(v => String(v || '').trim() && !hasLetters(v)).length;
      if (numericish > nonEmpty / 2) score -= 3;
      if (score > bestScore) { bestScore = score; bestIdx = r; }
    }
    return bestIdx;
  } catch (_) {
    return 0;
  }
}
