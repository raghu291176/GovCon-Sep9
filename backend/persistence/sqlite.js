// SQLite persistence (optional). Falls back to in-memory if dependency missing.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function tryRequireBetterSqlite3() {
  try {
    const require = createRequire(import.meta.url);
    // better-sqlite3 is CommonJS; require returns a constructor
    return require('better-sqlite3');
  } catch (_) {
    return null;
  }
}

function ensureTables(db) {
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS gl_entries (
      id TEXT PRIMARY KEY,
      account_number TEXT,
      description TEXT,
      amount REAL,
      date TEXT,
      category TEXT,
      vendor TEXT,
      contract_number TEXT,
      created_at TEXT,
      doc_summary TEXT,
      doc_flag_unallowable INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      filename TEXT,
      mime_type TEXT,
      text_content TEXT,
      created_at TEXT,
      doc_type TEXT
    );
    CREATE TABLE IF NOT EXISTS document_approvals (
      id TEXT PRIMARY KEY,
      document_id TEXT,
      approver TEXT,
      title TEXT,
      date TEXT,
      decision TEXT,
      comments TEXT,
      targetType TEXT
    );
    CREATE TABLE IF NOT EXISTS doc_items (
      id TEXT PRIMARY KEY,
      document_id TEXT,
      kind TEXT,
      vendor TEXT,
      date TEXT,
      amount REAL,
      currency TEXT,
      details_json TEXT,
      text_excerpt TEXT
    );
    CREATE TABLE IF NOT EXISTS gl_doc_links (
      document_item_id TEXT,
      gl_entry_id TEXT,
      score REAL,
      doc_summary TEXT,
      doc_flag_unallowable INTEGER DEFAULT 0,
      PRIMARY KEY (document_item_id, gl_entry_id)
    );
    CREATE TABLE IF NOT EXISTS kv_config (
      key TEXT PRIMARY KEY,
      value_json TEXT
    );
  `);
}

export function setupSQLite(memory) {
  const BetterSqlite3 = tryRequireBetterSqlite3();
  if (!BetterSqlite3) {
    console.warn('[sqlite] better-sqlite3 not installed. Running in in-memory mode.');
    return null;
  }
  const customPath = process.env.SQLITE_PATH && String(process.env.SQLITE_PATH).trim();
  const dbPath = customPath || path.join(__dirname, '..', 'data.sqlite');
  if (customPath) {
    try { fs.mkdirSync(path.dirname(customPath), { recursive: true }); } catch (_) {}
  }
  let db;
  try {
    db = new BetterSqlite3(dbPath);
  } catch (e) {
    console.warn('[sqlite] better-sqlite3 present but native binding unavailable. Falling back to in-memory.');
    console.warn('[sqlite] Details:', e?.message || e);
    return null;
  }
  ensureTables(db);

  const insertGl = db.prepare(`INSERT OR REPLACE INTO gl_entries
    (id, account_number, description, amount, date, category, vendor, contract_number, created_at, doc_summary, doc_flag_unallowable)
    VALUES (@id, @account_number, @description, @amount, @date, @category, @vendor, @contract_number, @created_at, @doc_summary, @doc_flag_unallowable)`);

  const insertDoc = db.prepare(`INSERT OR REPLACE INTO documents
    (id, filename, mime_type, text_content, created_at, doc_type)
    VALUES (@id, @filename, @mime_type, @text_content, @created_at, @doc_type)`);

  const insertApproval = db.prepare(`INSERT OR REPLACE INTO document_approvals
    (id, document_id, approver, title, date, decision, comments, targetType)
    VALUES (@id, @document_id, @approver, @title, @date, @decision, @comments, @targetType)`);

  const insertDocItem = db.prepare(`INSERT OR REPLACE INTO doc_items
    (id, document_id, kind, vendor, date, amount, currency, details_json, text_excerpt)
    VALUES (@id, @document_id, @kind, @vendor, @date, @amount, @currency, @details_json, @text_excerpt)`);

  const insertLink = db.prepare(`INSERT OR REPLACE INTO gl_doc_links
    (document_item_id, gl_entry_id, score, doc_summary, doc_flag_unallowable)
    VALUES (@document_item_id, @gl_entry_id, @score, @doc_summary, @doc_flag_unallowable)`);

  const deleteLink = db.prepare(`DELETE FROM gl_doc_links WHERE document_item_id = ? AND gl_entry_id = ?`);

  const saveConfigStmt = db.prepare(`INSERT OR REPLACE INTO kv_config (key, value_json) VALUES (?, ?)`);
  const readConfigStmt = db.prepare(`SELECT value_json FROM kv_config WHERE key = ?`);

  function loadAll() {
    try {
      // Load GL entries
      const gl = db.prepare('SELECT * FROM gl_entries').all();
      if (Array.isArray(gl)) {
        memory.glEntries = gl.map(r => ({
          id: r.id,
          account_number: r.account_number,
          description: r.description,
          amount: Number(r.amount || 0),
          date: r.date ? new Date(r.date) : null,
          category: r.category,
          vendor: r.vendor,
          contract_number: r.contract_number,
          created_at: r.created_at ? new Date(r.created_at) : new Date(),
          doc_summary: r.doc_summary || null,
          doc_flag_unallowable: !!r.doc_flag_unallowable,
        }));
      }
      // Load documents
      const docs = db.prepare('SELECT * FROM documents').all();
      const approvals = db.prepare('SELECT * FROM document_approvals').all();
      const byDoc = new Map();
      for (const d of docs) {
        const doc = {
          id: d.id,
          filename: d.filename,
          mime_type: d.mime_type,
          text_content: d.text_content,
          created_at: d.created_at ? new Date(d.created_at) : new Date(),
          doc_type: d.doc_type,
          approvals: []
        };
        byDoc.set(String(d.id), doc);
      }
      for (const a of approvals) {
        const arr = byDoc.get(String(a.document_id))?.approvals;
        if (arr) arr.push({ id: a.id, approver: a.approver, title: a.title, date: a.date, decision: a.decision, comments: a.comments, targetType: a.targetType });
      }
      memory.documents = Array.from(byDoc.values());
      // Load doc items
      const items = db.prepare('SELECT * FROM doc_items').all();
      memory.docItems = items.map(i => ({
        id: i.id,
        document_id: i.document_id,
        kind: i.kind,
        vendor: i.vendor,
        date: i.date,
        amount: i.amount,
        currency: i.currency,
        details: (i.details_json ? (() => { try { return JSON.parse(i.details_json); } catch { return {}; } })() : {}),
        text_excerpt: i.text_excerpt,
      }));
      // Load links
      const links = db.prepare('SELECT * FROM gl_doc_links').all();
      memory.glDocLinks = links.map(l => ({
        document_item_id: String(l.document_item_id),
        gl_entry_id: String(l.gl_entry_id),
        score: Number(l.score || 0),
        doc_summary: l.doc_summary || null,
        doc_flag_unallowable: !!l.doc_flag_unallowable,
      }));
      // Load configs
      try { const t = readConfigStmt.get('app_config'); if (t?.value_json) memory.appConfig = JSON.parse(t.value_json); } catch {}
      try { const t = readConfigStmt.get('llm_config'); if (t?.value_json) memory.llm = JSON.parse(t.value_json); } catch {}
      try { const t = readConfigStmt.get('di_config'); if (t?.value_json) memory.di = JSON.parse(t.value_json); } catch {}
    } catch (e) {
      console.warn('[sqlite] loadAll failed:', e?.message || e);
    }
  }

  function insertGLEntries(rows) {
    const tx = db.transaction((arr) => { arr.forEach(r => insertGl.run(r)); });
    tx(rows);
  }

  function saveDocument(doc, approvalsArr) {
    insertDoc.run(doc);
    const tx = db.transaction((arr, docId) => {
      arr.forEach(a => insertApproval.run({ id: a.id, document_id: docId, approver: a.approver || null, title: a.title || null, date: a.date || null, decision: a.decision || null, comments: a.comments || null, targetType: a.targetType || null }));
    });
    tx(approvalsArr || [], doc.id);
  }

  function saveDocItems(items) {
    const tx = db.transaction((arr) => {
      arr.forEach(i => insertDocItem.run({
        id: i.id,
        document_id: i.document_id,
        kind: i.kind || null,
        vendor: i.vendor || null,
        date: i.date || null,
        amount: typeof i.amount === 'number' ? i.amount : null,
        currency: i.currency || null,
        details_json: JSON.stringify(i.details || {}),
        text_excerpt: i.text_excerpt || null,
      }));
    });
    tx(items || []);
  }

  function saveLinks(links) {
    const tx = db.transaction((arr) => { arr.forEach(l => insertLink.run(l)); });
    tx(links || []);
  }

  function removeLink(document_item_id, gl_entry_id) {
    deleteLink.run(String(document_item_id), String(gl_entry_id));
  }

  function saveConfig(key, obj) {
    try { saveConfigStmt.run(String(key), JSON.stringify(obj || {})); } catch (e) {}
  }

  // Initial load into memory
  loadAll();

  return {
    db,
    loadAll,
    insertGLEntries,
    saveDocument,
    saveDocItems,
    saveLinks,
    removeLink,
    saveConfig,
  };
}
