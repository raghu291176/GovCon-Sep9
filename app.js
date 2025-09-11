// FAR Compliance Audit System - Orchestrator (ES Modules)
// No hardcoded sample data or rule fallback
import { auditAll } from "./modules/services/auditService.js";
import { readExcelFile, mapExcelRows, readExcelAsAOA, mapRowsFromAOA, detectHeaderRow } from "./modules/services/excelService.js";
import { MicrosoftClient } from "./modules/services/microsoftService.js";
import { renderGLTable, filterData } from "./modules/ui/tableView.js";
import { updateDashboard as updateDashboardUI } from "./modules/ui/dashboard.js";
import { generateReport as genReport, exportToPDF as exportPDF } from "./modules/reports/reportService.js";
// Anomaly detection removed
import { saveGLEntries, /*loadServerConfig, saveServerConfig, loadLLMConfig, saveLLMConfig,*/ serverLLMReview, serverLLMMapColumns, /*testLLM,*/ ingestDocuments, listDocItems, getRequirements, fetchGLEntries, linkDocItem, unlinkDocItem /*, loadDIConfig, saveDIConfig*/ } from "./modules/services/apiService.js";
import { farRules as builtinFarRules } from "./modules/data/farRules.js";

class FARComplianceApp {
  constructor() {
    this.glData = [];
    this.auditResults = [];
    this.charts = { complianceChart: null, violationsChart: null, amountChart: null };
    this.uploadedFile = null;
    this.farRules = [];
    this.config = {}; // no high-amount threshold
    this.apiBaseUrl = null;
    this.azure = { endpoint: '', apiKey: '', deployment: '', apiVersion: '2024-06-01' };
    this.mappingState = { aoa: [], headers: [], headerRowIndex: 0 };
    this.docs = { files: [], items: [], links: [], summaryEl: null, statusEl: null };
    this.req = { rows: [], map: new Map() };
    this.msal = { client: null, cfg: null };
  }

  async init() {
    await this.loadConfig();
    this.setupEventListeners();
    this.setupFileUpload();
    // Settings UI removed; configuration is environment-only
    this.setupMicrosoftUI();
    this.setupDocsUI();
    this.setupAdminUI();
    // With docs merged into Upload, refresh docs state on load
    try {
      await this.refreshDocsSummary();
      await this.refreshRequirementsSummary();
      // Re-render to show new links and counts
      this.renderGLTable();
      this.updateDashboard();
      await this.renderUnmatchedList();
      await this.renderUnmatchedList();
    } catch (_) {}
    this.renderGLTable();
    this.updateDashboard();
    // Ensure docs upload UI reflects GL presence
    try { await this.updateDocsControlsEnabled(); } catch (_) {}
  }

  async loadConfig() {
    try {
      // Use built-in FAR rules (modules/data/farRules.js)
      this.farRules = builtinFarRules || [];
      // Optional JSON override to extend/replace rules without rebuild
      try {
        const rr = await fetch('./config/farRules.json');
        if (rr.ok) {
          const ext = await rr.json();
          if (Array.isArray(ext) && ext.length) {
            // Merge by section: JSON overrides take precedence
            const bySec = new Map((this.farRules || []).map(r => [r.section, r]));
            for (const r of ext) {
              if (r && r.section) bySec.set(r.section, r);
            }
            this.farRules = Array.from(bySec.values());
          }
        }
      } catch (_) { /* ignore optional override errors */ }

      // Optional static config for API base URL and MSAL
      const cfgRes = await fetch('./config/appConfig.json');
      if (cfgRes.ok) {
        const cfg = await cfgRes.json();
        if (cfg.apiBaseUrl) this.apiBaseUrl = cfg.apiBaseUrl;
        if (cfg.msal) this.msal.cfg = cfg.msal;
      }
      // Default to same-origin API if not specified
      if (!this.apiBaseUrl) this.apiBaseUrl = window.location.origin;
      // Optional separate MSAL config file
      try {
        const ms = await fetch('./config/msal.json');
        if (ms.ok) this.msal.cfg = await ms.json();
      } catch (_) {}

      // Local Azure fallback removed; server handles LLM via environment
    } catch (e) {
      console.warn('Failed to load config. Using defaults.', e);
    }
    // If FAR rules not found, proceed with empty ruleset (user-managed JSON only)

    // No server-side settings to load; policy and provider come from environment
  }

  // No sample data; wait for user upload

  runInitialAudit() {
    this.auditResults = auditAll(this.glData, this.farRules, this.config);
  }

  setupEventListeners() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const tabName = e.target.getAttribute("data-tab");
        this.switchTab(tabName);
      });
    });

    const runAuditBtn = document.getElementById("run-audit-btn");
    const llmBtn = document.getElementById("llm-review-btn");
    if (runAuditBtn) {
      runAuditBtn.addEventListener("click", (e) => {
        e.preventDefault();
        this.runAudit();
      });
    }
    if (llmBtn) {
      llmBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        await this.runLLMReview();
      });
    }
    const pendingOnlyEl = document.getElementById('pending-only');
    if (pendingOnlyEl && !pendingOnlyEl.dataset.bound) {
      pendingOnlyEl.addEventListener('change', () => this.filterTable());
      pendingOnlyEl.dataset.bound = 'true';
    }
    const toggleDbg = document.getElementById('toggle-llm-debug');
    if (toggleDbg) {
      toggleDbg.addEventListener('click', (e) => {
        e.preventDefault();
        const card = document.getElementById('llm-debug-card');
        if (!card) return;
        card.style.display = (card.style.display === 'none') ? '' : 'none';
        toggleDbg.textContent = (card.style.display === 'none') ? 'Show' : 'Hide';
      });
    }

    const severityFilter = document.getElementById("severity-filter");
    const searchInput = document.getElementById("search-input");
    if (severityFilter) {
      severityFilter.addEventListener("change", () => this.filterTable());
    }
    if (searchInput) {
      searchInput.addEventListener("input", () => this.filterTable());
    }

    const generateReportBtn = document.getElementById("generate-report-btn");
    const exportPdfBtn = document.getElementById("export-pdf-btn");
    if (generateReportBtn) {
      generateReportBtn.addEventListener("click", (e) => {
        e.preventDefault();
        this.generateReport();
      });
    }
    if (exportPdfBtn) {
      exportPdfBtn.addEventListener("click", (e) => {
        e.preventDefault();
        this.exportToPDF();
      });
    }
  }

  setupFileUpload() {
    const fileInput = document.getElementById("file-input");
    const processBtn = document.getElementById("process-btn");
    if (!fileInput || !processBtn) return;

    fileInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files.length > 0) {
        this.handleFileUpload(e.target.files[0]);
        // Auto-process right after selection for better UX
        setTimeout(() => this.processUploadedFile(), 0);
      }
    });

    processBtn.addEventListener("click", (e) => {
      e.preventDefault();
      this.processUploadedFile();
    });
  }

  setupMicrosoftUI() {
    try {
      const loginBtn = document.getElementById('ms-login-btn');
      const logoutBtn = document.getElementById('ms-logout-btn');
      const status = document.getElementById('ms-status');
      const searchInput = document.getElementById('ms-search-input');
      const searchBtn = document.getElementById('ms-search-btn');
      const recentBtn = document.getElementById('ms-recent-btn');
      const importBtn = document.getElementById('ms-import-btn');
      const selectAllBtn = document.getElementById('ms-select-all');
      const browseBtn = document.getElementById('ms-browse-btn');
      const upBtn = document.getElementById('ms-folder-up');
      const useFolderBtn = document.getElementById('ms-use-folder-btn');
      const includeSub = document.getElementById('ms-include-sub');
      const pathSpan = document.getElementById('ms-path');
      const filesHost = document.getElementById('ms-files');
      const cfg = this.msal.cfg || {};
      const setStatus = (msg) => { if (status) status.textContent = msg || ''; };
      if (!cfg.clientId) {
        setStatus('MSAL not configured (missing clientId).');
        return;
      }
      this.msal.client = new MicrosoftClient({ clientId: cfg.clientId, authority: cfg.authority, redirectUri: cfg.redirectUri });
      try { this.msal.client.init(); } catch (_) {}

      let msCurrentItems = [];
      this.msal.mode = 'all'; // 'gl' | 'docs' | 'all'
      let msNav = []; // stack of folder objects: { id, name }
      const setPath = () => { if (pathSpan) pathSpan.textContent = '/' + (msNav.map(n => n.name).join('/') || ''); };
      const renderList = (items) => {
        if (!filesHost) return;
        msCurrentItems = items || [];
        if (!msCurrentItems.length) { filesHost.style.display = 'none'; filesHost.innerHTML = ''; return; }
        const rows = msCurrentItems.map((it, idx) => {
          const name = it.name || '';
          const web = it.webUrl || '';
          const isFolder = !!it.folder;
          const ext = isFolder ? 'folder' : ((name.split('.').pop() || '').toLowerCase());
          const pick = isFolder ? '' : `<input type=\"checkbox\" data-pick=\"${idx}\">`;
          return `<tr data-idx=\"${idx}\" data-kind=\"${isFolder ? 'folder' : 'file'}\"><td style=\"width:28px;\">${pick}</td><td>${name}</td><td>${ext}</td><td>${web ? `<a href=\"${web}\" target=\"_blank\" rel=\"noopener\">Open Link</a>` : ''}</td></tr>`;
        }).join('');
        const head = '<tr><th style="width:28px;"></th><th>File</th><th>Type</th><th>Link</th></tr>';
        filesHost.innerHTML = `<table class=\"data-table\"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
        filesHost.style.display = '';
        filesHost.querySelectorAll('tbody tr').forEach((tr) => {
          tr.addEventListener('click', async () => {
            const idx = Number(tr.getAttribute('data-idx'));
            const item = msCurrentItems[idx];
            try {
              const kind = tr.getAttribute('data-kind');
              if (kind === 'folder') {
                // Navigate into folder
                msNav.push({ id: item.id, name: item.name || '' });
                setPath();
                setStatus('Loading...');
                const children = await this.msal.client.listChildren(item.id);
                renderList(children);
                setStatus('');
              } else {
                // Toggle checkbox selection
                const cb = tr.querySelector('input[type=\"checkbox\"][data-pick]');
                if (cb) cb.checked = !cb.checked;
              }
            } catch (err) {
              setStatus('Action failed');
              alert('Open/import failed: ' + (err?.message || err));
            }
          });
        });
      };

      if (loginBtn) loginBtn.addEventListener('click', async () => {
        try { await this.msal.client.login(); setStatus('Signed in'); } catch (e) { setStatus('Sign-in failed'); }
      });
      if (logoutBtn) logoutBtn.addEventListener('click', async () => {
        try { await this.msal.client.logout(); setStatus('Signed out'); if (filesHost) { filesHost.style.display = 'none'; filesHost.innerHTML = ''; } } catch (_) {}
      });
      const doSearch = async () => {
        try {
          setStatus('Searching...');
          const q = (searchInput && searchInput.value) || '';
          let items = await this.msal.client.searchAll(q);
          // Filter by mode if set
          const mode = this.msal.mode || 'all';
          if (mode === 'gl') items = items.filter(it => /\.(xlsx?|xls)$/i.test(it.name || ''));
          if (mode === 'docs') items = items.filter(it => /\.(pdf|png|jpg|jpeg|docx)$/i.test(it.name || ''));
          renderList(items);
          setStatus('');
        } catch (e) { setStatus('Search failed'); }
      };
      if (searchBtn) searchBtn.addEventListener('click', doSearch);
      if (recentBtn) recentBtn.addEventListener('click', async () => {
        try { setStatus('Loading recent...'); const items = await this.msal.client.listRecentAll(); renderList(items); setStatus(''); } catch (e) { setStatus('Load failed'); }
      });

      if (browseBtn) browseBtn.addEventListener('click', async () => {
        try {
          msNav = [];
          setPath();
          setStatus('Loading root...');
          const children = await this.msal.client.listChildren(null);
          renderList(children);
          setStatus('');
        } catch (e) { setStatus('Browse failed'); }
      });
      if (upBtn) upBtn.addEventListener('click', async () => {
        try {
          if (msNav.length === 0) return; // already at root
          msNav.pop();
          setPath();
          const parentId = msNav.length ? msNav[msNav.length - 1].id : null;
          setStatus('Loading...');
          const children = await this.msal.client.listChildren(parentId);
          renderList(children);
          setStatus('');
        } catch (e) { setStatus('Load failed'); }
      });
      if (useFolderBtn) useFolderBtn.addEventListener('click', async () => {
        try {
          const folderId = msNav.length ? msNav[msNav.length - 1].id : null; // null => root
          const recursive = !!(includeSub && includeSub.checked);
          setStatus('Gathering files...');
          const files = await this.msal.client.listFolderFiles(folderId, recursive);
          // Render in the list and select all
          renderList(files);
          if (filesHost) filesHost.querySelectorAll('input[type="checkbox"][data-pick]').forEach(cb => cb.checked = true);
          setStatus('');
        } catch (e) { setStatus('Use folder failed'); }
      });

      if (selectAllBtn) selectAllBtn.addEventListener('click', () => {
        if (!filesHost) return;
        filesHost.querySelectorAll('input[type="checkbox"][data-pick]').forEach(cb => { cb.checked = true; });
      });
      if (importBtn) importBtn.addEventListener('click', async () => {
        try {
          const indices = Array.from(filesHost.querySelectorAll('input[type="checkbox"][data-pick]:checked')).map(cb => Number(cb.getAttribute('data-pick')));
          if (!indices.length) { setStatus('No files selected'); return; }
          setStatus(`Downloading ${indices.length} files...`);
          const excelItems = [];
          const docFiles = [];
          // Partition by extension
          for (const i of indices) {
            const it = msCurrentItems[i];
            const name = (it.name || '').toLowerCase();
            if (/\.(xlsx|xls)$/.test(name)) {
              excelItems.push(it);
            } else if (/\.(pdf|png|jpg|jpeg|docx)$/.test(name)) {
              const f = await this.msal.client.downloadItemAsFile(it);
              docFiles.push(f);
            }
          }
          const mode = this.msal.mode || 'all';
          // Import GL workbooks (merge rows)
          let importedRows = [];
          if (mode !== 'docs') for (const item of excelItems) {
            const aoa = await this.msal.client.fetchWorkbookAOA(item);
            // Auto-map without mutating current glData
            const hIdx = detectHeaderRow(aoa);
            const headers = (aoa[hIdx] || []).map(v => String(v || ''));
            const sig = this.headerSignature(headers);
            const saved = this.loadMappingBySignature()[sig];
            let mapping = saved && saved.mapping ? saved.mapping : this.guessMapping(headers);
            try {
              if (!saved && this.apiBaseUrl) {
                // Best-effort LLM mapping
                const sampleRows = [];
                for (let r = hIdx + 1; r < Math.min(aoa.length, hIdx + 6); r++) {
                  const row = aoa[r] || [];
                  const obj = {};
                  headers.forEach((h, i) => { obj[h] = row[i]; });
                  sampleRows.push(obj);
                }
                const res = await serverLLMMapColumns(this.apiBaseUrl, headers, sampleRows);
                mapping = res.mapping || mapping;
              }
            } catch (_) {}
            const rows = mapRowsFromAOA(aoa, mapping, hIdx) || [];
          if (rows.length) importedRows = importedRows.concat(rows);
        }
        if (importedRows.length) {
          if (this.apiBaseUrl) {
            const r = await saveGLEntries(this.apiBaseUrl, importedRows);
            if (r && Array.isArray(r.ids)) {
              importedRows = importedRows.map((row, i) => ({ ...row, id: r.ids[i] || row.id }));
            }
          }
          this.glData = (this.glData || []).concat(importedRows);
          this.runInitialAudit();
          this.renderGLTable();
          try { await this.updateDocsControlsEnabled(); } catch (_) {}
        }
          // Import documents in batches
          if (mode !== 'gl' && docFiles.length) {
            const statusEl = document.getElementById('docs-status');
            const chunk = 10;
            let linkedTotal = 0;
            for (let i = 0; i < docFiles.length; i += chunk) {
              const batch = docFiles.slice(i, i + chunk);
              if (statusEl) statusEl.textContent = `Uploading ${i + 1}-${Math.min(i + batch.length, docFiles.length)} of ${docFiles.length}...`;
              try {
                const resp = await ingestDocuments(this.apiBaseUrl, batch);
                const links = (resp?.results || []).reduce((acc, r) => acc + ((r?.links || []).length), 0);
                linkedTotal += Number(links || 0);
              } catch (_) {}
            }
            if (statusEl) statusEl.textContent = 'Parsed documents.';
            await this.refreshDocsSummary();
            await this.refreshRequirementsSummary();
            // Re-render to reflect attachments
            this.renderGLTable();
            this.updateDashboard();
            await this.renderUnmatchedList();
            try {
              const rep = document.getElementById('upload-report');
              const rtoast = document.getElementById('review-toast');
              const msg = linkedTotal > 0 ? (`Auto-linked ${linkedTotal} item${linkedTotal === 1 ? '' : 's'} to GL.`) : 'No auto-links were created.';
              if (rep) rep.textContent = msg;
              if (rtoast) rtoast.textContent = msg;
            } catch (_) {}
          }
          setStatus('');
        } catch (e) {
          setStatus('Import failed');
          alert('Import failed: ' + (e?.message || e));
        }
      });

      // Open/close helpers
      const openPanel = (mode) => {
        this.msal.mode = mode || 'all';
        if (panel) panel.style.display = '';
        setPath();
        // Load a default view
        (async () => {
          try {
            const children = await this.msal.client.listChildren(null);
            // Filter by mode
            let items = children;
            if (this.msal.mode === 'gl') items = items.filter(it => it.folder || /\.(xlsx?|xls)$/i.test(it.name || ''));
            if (this.msal.mode === 'docs') items = items.filter(it => it.folder || /\.(pdf|png|jpg|jpeg|docx)$/i.test(it.name || ''));
            renderList(items);
          } catch (_) {}
        })();
      };
      if (openGl) openGl.addEventListener('click', () => openPanel('gl'));
      if (openDocs) openDocs.addEventListener('click', () => openPanel('docs'));
      if (closeBtn) closeBtn.addEventListener('click', () => { if (panel) panel.style.display = 'none'; });
    } catch (_) {}
  }

  handleFileUpload(file) {
    const name = (file.name || "").toLowerCase();
    if (!name.match(/\.(xlsx|xls)$/i)) {
      alert("Please upload an Excel file (.xlsx or .xls)");
      return;
    }
    const fileInfo = document.getElementById("file-info");
    const fileDetails = document.getElementById("file-details");
    if (fileInfo && fileDetails) {
      fileDetails.innerHTML = `
        <p><strong>File:</strong> ${file.name}</p>
        <p><strong>Size:</strong> ${(file.size / 1024).toFixed(2)} KB</p>
        <p><strong>Type:</strong> ${file.type}</p>`;
      fileInfo.classList.remove("hidden");
      this.uploadedFile = file;
    }
  }

  async processUploadedFile() {
    if (!this.uploadedFile) return;
    try {
      if (typeof XLSX === 'undefined') {
        alert('Excel parser (XLSX) not loaded. Please ensure you are online and the page can access cdnjs.');
        return;
      }
      const jsonData = await readExcelFile(this.uploadedFile);
      this.glData = mapExcelRows(jsonData);
      // If mapping looks weak, attempt auto-mapping from AOA
      const weak = this.isWeakMapping(this.glData);
      if (weak) {
        const aoa = await readExcelAsAOA(this.uploadedFile);
        const ok = await this.attemptAutoMappingFromAOA(aoa).catch(() => false);
        if (!ok) {
          // Fall back to manual mapping UI
          this.prepareMappingUI(aoa);
          return; // Wait for user to apply mapping
        }
      }
      // Persist to server if configured
      try {
        if (this.apiBaseUrl) {
          const r = await saveGLEntries(this.apiBaseUrl, this.glData);
          if (r && Array.isArray(r.ids)) {
            this.glData = this.glData.map((row, i) => ({ ...row, id: r.ids[i] || row.id }));
          }
          try { await this.updateDocsControlsEnabled(); } catch (_) {}
        }
      } catch (e) {
        console.warn('Failed to save GL entries to server:', e?.message || e);
      }
      this.runInitialAudit();
      this.renderGLTable();
      this.switchTab("review");
    } catch (error) {
      alert("Error processing Excel file: " + error.message);
    }
  }

  prepareMappingUI(aoa) {
    const mappingCard = document.getElementById('mapping-ui');
    const statusEl = document.getElementById('mapping-status');
    const headerInput = document.getElementById('header-row-input');
    const selects = {
      accountNumber: document.getElementById('map-account'),
      description: document.getElementById('map-description'),
      amount: document.getElementById('map-amount'),
      date: document.getElementById('map-date'),
      category: document.getElementById('map-category'),
      vendor: document.getElementById('map-vendor'),
      contractNumber: document.getElementById('map-contract'),
    };
    if (!mappingCard || !headerInput) return;
    mappingCard.classList.remove('hidden');
    // If we can, try to detect header row automatically and prefill
    let headerRowIndex = Math.max(0, Number(headerInput.value) - 1 || 0);
    try {
      const detected = detectHeaderRow(aoa);
      if (Number.isInteger(detected) && detected >= 0 && detected < aoa.length) {
        headerRowIndex = detected;
        headerInput.value = String(detected + 1);
      }
    } catch (_) {}
    const prevTable = document.getElementById('mapping-preview-table');
    const buildOptions = (arr) => arr.map(h => `<option value=\"${h}\">${h || '(empty)'}</option>`).join('');
    const setHeaders = (idx) => {
      const H = (aoa[idx] || []).map(v => String(v || ''));
      this.mappingState = { aoa, headers: H, headerRowIndex: idx };
      const options = buildOptions(H);
      Object.values(selects).forEach(sel => { if (sel) sel.innerHTML = `<option value=\"\">—</option>${options}`; });
      renderPreview();
      return H;
    };
    const renderPreview = () => {
      try {
        if (!prevTable) return;
        const H = this.mappingState.headers || [];
        const start = this.mappingState.headerRowIndex + 1;
        const end = Math.min(aoa.length, start + 25);
        const thead = `<thead><tr>${H.map((h, i) => `<th data-col-index=\"${i}\" style=\"cursor:pointer; position: sticky; top: 0; background: #f8fafc;\">${h || '&nbsp;'}</th>`).join('')}</tr></thead>`;
        const rows = [];
        for (let r = start; r < end; r++) {
          const row = aoa[r] || [];
          rows.push(`<tr>${H.map((_, c) => `<td>${row[c] != null ? String(row[c]) : ''}</td>`).join('')}</tr>`);
        }
        prevTable.innerHTML = `${thead}<tbody>${rows.join('')}</tbody>`;
      } catch (_) {}
    };
    let headers = setHeaders(headerRowIndex);
    // Try to load a saved mapping for this header signature; else auto-guess
    const sig = this.headerSignature(headers);
    const bySig = this.loadMappingBySignature();
    const saved = bySig[sig];
    if (saved && saved.mapping) {
      for (const key in saved.mapping) { if (selects[key]) selects[key].value = saved.mapping[key]; }
      // If saved headerRowIndex differs, reflect it
      if (typeof saved.headerRowIndex === 'number' && saved.headerRowIndex >= 0) {
        headerRowIndex = saved.headerRowIndex;
        this.mappingState.headerRowIndex = headerRowIndex;
        headerInput.value = String(headerRowIndex + 1);
      }
      if (statusEl) statusEl.textContent = 'Loaded saved mapping for this layout. Review and click Apply Mapping.';
    } else {
      // Auto-guess mapping based on known patterns
      const guess = this.guessMapping(headers);
      for (const key in guess) {
        if (selects[key]) selects[key].value = guess[key];
      }
      if (statusEl) statusEl.textContent = 'Auto-detected header row. Review and apply the mapping.';
    }

    // Excel-like interactions: focus mapping field, then click header to assign
    Object.keys(selects).forEach((k) => {
      const sel = selects[k];
      if (!sel || sel.dataset.boundFocus) return;
      sel.addEventListener('focus', () => { this.mappingFocusKey = k; if (statusEl) statusEl.textContent = `Assigning ${k}: click a column header...`; });
      sel.dataset.boundFocus = 'true';
    });
    if (prevTable && !prevTable.dataset.boundClick) {
      prevTable.addEventListener('click', (e) => {
        const th = e.target && e.target.closest && e.target.closest('th[data-col-index]');
        if (!th) return;
        const idx = Number(th.getAttribute('data-col-index')) || 0;
        const header = this.mappingState.headers[idx] || '';
        if (!this.mappingFocusKey) { if (statusEl) statusEl.textContent = 'Click into a field first, then a header.'; return; }
        const sel = selects[this.mappingFocusKey];
        if (sel) {
          sel.value = header;
          if (statusEl) statusEl.textContent = `Mapped ${this.mappingFocusKey} ↦ ${header || '(empty)'} (column ${idx + 1})`;
        }
      });
      prevTable.dataset.boundClick = 'true';
    }
    if (headerInput && !headerInput.dataset.boundChange) {
      headerInput.addEventListener('change', () => {
        const idx = Math.max(0, Number(headerInput.value) - 1 || 0);
        headers = setHeaders(idx);
        const guess2 = this.guessMapping(headers);
        for (const key in guess2) { if (selects[key] && !selects[key].value) selects[key].value = guess2[key]; }
      });
      headerInput.dataset.boundChange = 'true';
    }

    // Bind buttons once
    const applyBtn = document.getElementById('apply-mapping-btn');
    const saveBtn = document.getElementById('save-mapping-btn');
    const suggestBtn = document.getElementById('suggest-mapping-btn');
    if (applyBtn && !applyBtn.dataset.bound) {
      applyBtn.addEventListener('click', () => {
        this.mappingState.headerRowIndex = Math.max(0, Number(headerInput.value) - 1 || 0);
        const mapping = Object.fromEntries(Object.entries(selects).map(([k, sel]) => [k, sel.value]));
        try {
          const rows = mapRowsFromAOA(this.mappingState.aoa, mapping, this.mappingState.headerRowIndex);
          if (!rows.length) {
            if (statusEl) statusEl.textContent = 'No rows parsed with current mapping.';
            return;
          }
          this.glData = rows;
          // Persist per-layout mapping by header signature
          try {
            const sig = this.headerSignature(this.mappingState.headers || []);
            this.saveMappingBySignature(sig, { mapping, headerRowIndex: this.mappingState.headerRowIndex });
          } catch (_) {}
          // Persist to server if configured
          if (this.apiBaseUrl) {
            saveGLEntries(this.apiBaseUrl, this.glData).then((r) => {
              if (r && Array.isArray(r.ids)) this.glData = this.glData.map((row, i) => ({ ...row, id: r.ids[i] || row.id }));
            }).catch(() => {});
          }
          mappingCard.classList.add('hidden');
          this.runInitialAudit();
          this.renderGLTable();
          this.switchTab('review');
        } catch (e) {
          if (statusEl) statusEl.textContent = 'Failed to apply mapping.';
        }
      });
      applyBtn.dataset.bound = 'true';
    }
    if (saveBtn && !saveBtn.dataset.bound) {
      saveBtn.addEventListener('click', () => {
        const mapping = Object.fromEntries(Object.entries(selects).map(([k, sel]) => [k, sel.value]));
        const payload = { mapping, headerRowIndex: Math.max(0, Number(headerInput.value) - 1 || 0) };
        localStorage.setItem('columnMappingDefault', JSON.stringify(payload));
        if (statusEl) statusEl.textContent = 'Mapping saved as default.';
      });
      saveBtn.dataset.bound = 'true';
    }

    if (suggestBtn && !suggestBtn.dataset.bound) {
      suggestBtn.addEventListener('click', async () => {
        try {
          if (!this.apiBaseUrl) {
            if (statusEl) statusEl.textContent = 'Server LLM not available. Ensure backend is running.';
            return;
          }
          if (statusEl) statusEl.textContent = 'Requesting LLM suggestion...';
          const hIdx = Math.max(0, Number(headerInput.value) - 1 || 0);
          const headers = (this.mappingState.aoa[hIdx] || []).map(v => String(v || ''));
          // Build a few sample rows as objects keyed by header string
          const sampleRows = [];
          for (let r = hIdx + 1; r < Math.min(this.mappingState.aoa.length, hIdx + 6); r++) {
            const row = this.mappingState.aoa[r] || [];
            const obj = {};
            headers.forEach((h, i) => { obj[h] = row[i]; });
            sampleRows.push(obj);
          }
          const { mapping, headerRowIndex } = await serverLLMMapColumns(this.apiBaseUrl, headers, sampleRows);
          // If model proposed a different header row index, apply and rebuild headers/options
          const newHIdx = Math.max(0, Number(headerRowIndex) || hIdx);
          if (newHIdx !== hIdx) {
            headerInput.value = String(newHIdx + 1);
            const newHeaders = (this.mappingState.aoa[newHIdx] || []).map(v => String(v || ''));
            this.mappingState.headers = newHeaders;
            const opts = newHeaders.map(h => `<option value="${h}">${h || '(empty)'}</option>`).join('');
            Object.values(selects).forEach(sel => { if (sel) sel.innerHTML = `<option value="">—</option>${opts}`; });
          }
          // Apply mapping values where headers exist
          for (const key of Object.keys(selects)) {
            const val = mapping[key];
            if (val && selects[key]) selects[key].value = val;
          }
          if (statusEl) statusEl.textContent = 'LLM suggestion applied. Review and click Apply Mapping.';
          // Save as per-layout default
          try {
            const sig = this.headerSignature(this.mappingState.headers || headers);
            this.saveMappingBySignature(sig, { mapping, headerRowIndex: newHIdx });
          } catch (_) {}
        } catch (err) {
          if (statusEl) statusEl.textContent = 'LLM suggestion failed.';
        }
      });
      suggestBtn.dataset.bound = 'true';
    }

    // Auto-run LLM mapping once on open (non-destructive): prefill if no saved mapping
    if (!mappingCard.dataset.llmAutoRan && this.apiBaseUrl && !saved) {
      mappingCard.dataset.llmAutoRan = 'true';
      suggestBtn?.click();
    }
  }

  guessMapping(headers) {
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const H = headers.map(norm);
    function findOne(cands) {
      for (const c of cands) {
        const idx = H.indexOf(norm(c));
        if (idx >= 0) return headers[idx];
      }
      return '';
    }
    return {
      accountNumber: findOne(['account number','account','acct','gl account','glaccount']),
      description: findOne(['description','memo','details','detail','narration']),
      amount: findOne(['amount','amount ($)','total amount','net amount','line amount','extended amount','amt']),
      date: findOne(['date','posting date','txn date','transaction date','post date']),
      category: findOne(['category','gl category','account type','type','expense type']),
      vendor: findOne(['vendor','vendor name','supplier','payee']),
      contractNumber: findOne(['contract number','contract','contract #','contract#','contractno']),
    };
  }

  headerSignature(headers) {
    const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return (headers || []).map(normalize).join('|');
  }

  loadMappingBySignature() {
    try {
      const raw = localStorage.getItem('columnMappingBySig');
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }

  saveMappingBySignature(sig, value) {
    try {
      const all = this.loadMappingBySignature();
      all[String(sig || '')] = value || {};
      localStorage.setItem('columnMappingBySig', JSON.stringify(all));
    } catch (_) {}
  }

  async attemptAutoMappingFromAOA(aoa) {
    try {
      const hIdx = detectHeaderRow(aoa);
      const headers = (aoa[hIdx] || []).map(v => String(v || ''));
      // Prefer saved mapping for this layout
      const sig = this.headerSignature(headers);
      const saved = this.loadMappingBySignature()[sig];
      let mapping = null;
      let useHIdx = hIdx;
      if (saved && saved.mapping) {
        mapping = saved.mapping;
        if (typeof saved.headerRowIndex === 'number' && saved.headerRowIndex >= 0) useHIdx = saved.headerRowIndex;
      } else {
        // Try LLM mapping if server configured
        if (this.apiBaseUrl) {
          try {
            const sampleRows = [];
            for (let r = hIdx + 1; r < Math.min(aoa.length, hIdx + 6); r++) {
              const row = aoa[r] || [];
              const obj = {};
              headers.forEach((h, i) => { obj[h] = row[i]; });
              sampleRows.push(obj);
            }
            const res = await serverLLMMapColumns(this.apiBaseUrl, headers, sampleRows);
            mapping = res.mapping || null;
            if (typeof res.headerRowIndex === 'number' && res.headerRowIndex >= 0) useHIdx = res.headerRowIndex;
          } catch (_) {}
        }
        // Fallback to heuristic guess
        if (!mapping) mapping = this.guessMapping(headers);
      }
      const rows = mapRowsFromAOA(aoa, mapping, useHIdx);
      if (!rows || rows.length === 0) return false;
      // Basic sanity: require at least one non-zero amount or non-empty description
      const good = rows.some(r => Math.abs(Number(r.amount) || 0) > 0) || rows.some(r => (r.description || '').trim());
      if (!good) return false;
      // Persist mapping by signature
      try { this.saveMappingBySignature(sig, { mapping, headerRowIndex: useHIdx }); } catch (_) {}
      // Accept
      this.glData = rows;
      return true;
    } catch (_) {
      return false;
    }
  }

  isWeakMapping(rows) {
    try {
      const arr = Array.isArray(rows) ? rows : [];
      if (!arr.length) return true;
      const hasAmt = arr.filter(r => Math.abs(Number(r.amount) || 0) > 0).length / arr.length;
      const hasDesc = arr.filter(r => (String(r.description || '').trim().length > 0)).length / arr.length;
      const hasDate = arr.filter(r => {
        const d = r.date;
        if (!d) return false;
        if (typeof d === 'string') return /\d{4}-\d{2}-\d{2}/.test(d) || !isNaN(Date.parse(d));
        if (typeof d === 'number') return true; // Excel serials handled later
        return false;
      }).length / arr.length;
      return (hasAmt < 0.2) || (hasDesc < 0.2) || (hasDate < 0.2);
    } catch (_) { return true; }
  }

  switchTab(tabName) {
    document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.remove("active"));
    const activeBtn = document.querySelector(`[data-tab="${tabName}"]`);
    if (activeBtn) activeBtn.classList.add("active");

    document.querySelectorAll(".tab-content").forEach((content) => content.classList.remove("active"));
    const activeTab = document.getElementById(`${tabName}-tab`);
    if (activeTab) activeTab.classList.add("active");

    if (tabName === "dashboard") {
      setTimeout(() => this.updateDashboard(), 100);
    }
    // Documents UI merged into Upload tab
    if (tabName === 'upload') {
      setTimeout(async () => {
        await this.refreshDocsSummary();
        await this.refreshRequirementsSummary();
      }, 50);
    }
    if (tabName === 'review') {
      setTimeout(async () => {
        await this.refreshRequirementsSummary();
        await this.renderUnmatchedList();
      }, 50);
    }
  }

  async runLLMReview() {
    if (!this.glData || this.glData.length === 0) {
      alert('Please upload and process a GL file first.');
      return;
    }
    const processingIndicator = document.getElementById("processing-indicator");
    if (processingIndicator) processingIndicator.classList.remove("hidden");
    const showDebug = (textOrObj) => {
      try {
        const card = document.getElementById('llm-debug-card');
        const pre = document.getElementById('llm-debug');
        if (!card || !pre) return;
        const txt = (typeof textOrObj === 'string') ? textOrObj : JSON.stringify(textOrObj || {}, null, 2);
        pre.textContent = txt || '';
        card.style.display = '';
      } catch (_) {}
    };
    // Ensure debug panel is visible during the call
    showDebug('Sending request to LLM...');
    try {
      // Build payload with explicit global index for LLM mapping
      let allRows = (this.glData || []).map((r, idx) => ({ ...r, index: idx }));
      // Enrich with attachment info from server if available
      try {
        if (this.apiBaseUrl) {
          const req = await getRequirements(this.apiBaseUrl);
          const map = new Map((req.rows || []).map(x => [String(x.id), x]));
          allRows = allRows.map(r => {
            const m = r.id ? map.get(String(r.id)) : null;
            if (m) return { ...r, attachmentsCount: m.attachmentsCount || 0, hasReceipt: !!m.hasReceipt };
            return r;
          });
        }
      } catch (_) {}
      let results = [];
      let debug = null;
      try {
        // Prefer server review via same-origin proxy (/api/*)
        console.log('Attempting LLM review with apiBaseUrl:', this.apiBaseUrl);
        // Single request with all rows
        const resp = await serverLLMReview(this.apiBaseUrl, allRows);
        if (resp && Array.isArray(resp.results)) {
          results = resp.results;
          debug = { raw: resp.llm_raw || '', parsed: resp.llm_parsed || null, warning: resp.warning || null, logs: resp.llm_logs || [] };
        } else if (Array.isArray(resp)) {
          // backward compatibility
          results = resp;
        }
      } catch (err) {
        console.error('Server LLM review failed:', err);
        // Surface error in the LLM Debug card so it's visible even on failure
        showDebug(String(err?.message || err || 'Unknown error'));
        // Fallback: optional browser-only Azure path (local use)
        if (this.azure?.endpoint && this.azure?.apiKey && this.azure?.deployment) {
          const res = await import('./modules/services/azureService.js');
          results = await res.azureReview(allRows, this.azure);
        } else {
          // Also show an alert for visibility
          alert('LLM review failed: ' + (err?.message || err) + '. Backend API URL: ' + (this.apiBaseUrl || 'not set'));
          return;
        }
      }
      // Render debug
      if (debug) showDebug({ warning: debug.warning || undefined, logs: debug.logs || [], parsed: debug.parsed || undefined, raw: debug.raw || undefined });
      if (!results || results.length === 0) {
        alert('LLM review unavailable. Ensure backend is running and Azure env vars are set.');
        return;
      }
      const mapStatus = (cls) => {
        const c = String(cls || '').toUpperCase();
        if (c === 'ALLOWED') return 'GREEN';
        if (c === 'UNALLOWABLE') return 'RED';
        return 'YELLOW';
      };
      this.auditResults = this.glData.map((row, idx) => {
        const match = results.find(r => r.index === idx);
        if (!match) return row;
        return {
          ...row,
          status: mapStatus(match.classification),
          farIssue: match.rationale || row.farIssue || '',
          farSection: match.farSection || row.farSection || ''
        };
      });
      this.renderGLTable();
      this.updateDashboard();
      this.switchTab('review');
    } catch (e) {
      alert('LLM review failed: ' + (e?.message || e));
    } finally {
      if (processingIndicator) processingIndicator.classList.add("hidden");
    }
  }

  runAudit() {
    const processingIndicator = document.getElementById("processing-indicator");
    if (processingIndicator) processingIndicator.classList.remove("hidden");

    setTimeout(() => {
      this.auditResults = auditAll(this.glData, this.farRules, this.config);
      if (processingIndicator) processingIndicator.classList.add("hidden");
      this.renderGLTable();
      this.updateDashboard();
    }, 2000);
  }

  renderGLTable() {
    const base = this.auditResults.length > 0 ? this.auditResults : this.glData;
    const map = this.req && this.req.map ? this.req.map : new Map();
    const pendingOnlyEl = document.getElementById('pending-only');
    let augmented = (base || []).map((row) => {
      const r = row && row.id ? map.get(String(row.id)) : null;
      if (!r) return row;
      const approvalState = this.computeApprovalState(row, r);
      return { ...row, attachmentsCount: r.attachmentsCount, hasReceipt: r.hasReceipt, approvalsCount: r.approvalsCount, hasApproval: r.hasApproval, approvalState };
    });
    if (pendingOnlyEl && pendingOnlyEl.checked) {
      augmented = augmented.filter((row) => {
        const r = row && row.id ? map.get(String(row.id)) : null;
        return !!(r && (r.receiptRequired || r.approvalRequired) && !r.hasReceipt);
      });
    }
    renderGLTable(augmented);
    // After rendering, populate linked document sections if we have docs state
    try { this.populateLinkedSections(); } catch (_) {}
    try { this.bindQuickLinkButtons(); } catch (_) {}
  }

  filterTable() {
    const severityFilter = document.getElementById("severity-filter");
    const searchInput = document.getElementById("search-input");
    const pendingOnlyEl = document.getElementById('pending-only');
    if (!severityFilter || !searchInput) return;
    const base = (this.auditResults && this.auditResults.length > 0) ? this.auditResults : this.glData;
    const filtered = filterData(base, severityFilter.value, searchInput.value);
    const map = this.req && this.req.map ? this.req.map : new Map();
    let augmented = (filtered || []).map((row) => {
      const r = row && row.id ? map.get(String(row.id)) : null;
      if (!r) return row;
      const approvalState = this.computeApprovalState(row, r);
      return { ...row, attachmentsCount: r.attachmentsCount, hasReceipt: r.hasReceipt, approvalsCount: r.approvalsCount, hasApproval: r.hasApproval, approvalState };
    });
    if (pendingOnlyEl && pendingOnlyEl.checked) {
      augmented = augmented.filter((row) => {
        const r = row && row.id ? map.get(String(row.id)) : null;
        return !!(r && (r.receiptRequired || r.approvalRequired) && !r.hasReceipt);
      });
    }
    renderGLTable(augmented);
    try { this.populateLinkedSections(); } catch (_) {}
  }

  updateDashboard() {
    this.charts = updateDashboardUI(this.auditResults, this.glData, this.charts);
  }

  generateReport() {
    genReport(this.auditResults, this.glData);
  }

  exportToPDF() {
    exportPDF();
  }

  setupDocsUI() {
    const input = document.getElementById('docs-input');
    const btn = document.getElementById('ingest-docs-btn');
    const statusEl = document.getElementById('docs-status');
    const summaryEl = document.getElementById('docs-summary');
    this.docs.statusEl = statusEl;
    this.docs.summaryEl = summaryEl;
    const uploadBatches = async (files) => {
      if (!this.apiBaseUrl) { if (statusEl) statusEl.textContent = 'Server not available. Ensure backend is running.'; return; }
      const list = Array.from(files || []);
      if (!list.length) { if (statusEl) statusEl.textContent = 'No files selected.'; return; }
      // Guard: require GL to be present before uploading documents
      try {
        const gl = await fetchGLEntries(this.apiBaseUrl, 1, 0);
        const count = Array.isArray(gl.rows) ? gl.rows.length : 0;
        if ((this.glData?.length || 0) === 0 && count === 0) {
          if (statusEl) statusEl.textContent = 'Please import GL entries before adding documents.';
          alert('Please import GL entries before adding documents.');
          return;
        }
      } catch (_) {}
      const chunk = 10; // backend accepts 10 files per request
      let linkedTotal = 0;
      let codexCount = 0;
      
      for (let i = 0; i < list.length; i += chunk) {
        const batch = list.slice(i, i + chunk);
        if (statusEl) statusEl.textContent = `Uploading ${i + 1}-${Math.min(i + batch.length, list.length)} of ${list.length}...`;
        try {
          const resp = await ingestDocuments(this.apiBaseUrl, batch);
          const links = (resp?.results || []).reduce((acc, r) => acc + ((r?.links || []).length), 0);
          linkedTotal += Number(links || 0);
          
          // Count Codex processed files
          const codexResults = (resp?.results || []).filter(r => r.codex_processing);
          codexCount += codexResults.length;
          
          // Show Codex processing info in console
          if (codexResults.length > 0) {
            console.log('Codex enhanced processing used for', codexResults.length, 'documents:', 
              codexResults.map(r => ({
                filename: r.filename,
                method: r.codex_processing?.processing_method,
                matches: r.codex_processing?.matches_found,
                confidence: r.codex_processing?.confidence_scores
              }))
            );
          }
        } catch (_) {}
      }
      
      const codexMsg = codexCount > 0 ? ` (${codexCount} enhanced with Codex OCR)` : '';
      if (statusEl) statusEl.textContent = `Parsed documents${codexMsg}.`;
      
      await this.refreshDocsSummary();
      await this.refreshRequirementsSummary();
      try {
        const rep = document.getElementById('upload-report');
        const rtoast = document.getElementById('review-toast');
        const baseMsg = linkedTotal > 0 ? (`Auto-linked ${linkedTotal} item${linkedTotal === 1 ? '' : 's'} to GL.`) : 'No auto-links were created.';
        const msg = baseMsg + codexMsg;
        if (rep) rep.textContent = msg;
        if (rtoast) rtoast.textContent = msg;
      } catch (_) {}
    };

    if (btn && input) {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        try { await uploadBatches(input.files || []); } catch (err) { if (statusEl) statusEl.textContent = 'Ingest failed.'; alert('Failed to ingest docs: ' + (err?.message || err)); }
      });
    }

    // Drag & drop support
    const drop = document.getElementById('docs-dropzone');
    if (drop) {
      ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); drop.style.background = '#f1f5f9'; }));
      ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); drop.style.background = ''; }));
      drop.addEventListener('drop', async (e) => {
        const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
        const allowed = files.filter(f => /\.(pdf|png|jpg|jpeg|docx)$/i.test(f.name));
        try { await uploadBatches(allowed); } catch (err) { if (statusEl) statusEl.textContent = 'Ingest failed.'; alert('Failed to ingest docs: ' + (err?.message || err)); }
      });
    }
  }

  setupAdminUI() {
    try {
      const s = (msg) => { const el = document.getElementById('admin-status'); if (el) el.textContent = msg || ''; };
      const doCall = async (path) => {
        if (!this.apiBaseUrl) { s('Server not available.'); return; }
        s('Working...');
        const url = `${this.apiBaseUrl.replace(/\/$/, '')}${path}`;
        const res = await fetch(url, { method: 'DELETE' });
        if (!res.ok) throw new Error(await res.text().catch(() => 'Failed'));
        // Clear local state as well
        if (path.includes('clear-gl') || path.includes('clear-all')) this.glData = [];
        if (path.includes('clear-docs') || path.includes('clear-all')) this.docs = { ...this.docs, items: [], links: [], documents: [] };
        await this.refreshDocsSummary();
        await this.refreshRequirementsSummary();
        this.renderGLTable();
        this.updateDashboard();
        await this.renderUnmatchedList();
        try { await this.updateDocsControlsEnabled(); } catch (_) {}
        s('Done.');
      };
      // Modal helpers
      const modal = document.getElementById('confirm-modal');
      const titleEl = document.getElementById('confirm-title');
      const msgEl = document.getElementById('confirm-message');
      const okBtn = document.getElementById('confirm-ok');
      const cancelBtn = document.getElementById('confirm-cancel');
      let pendingAction = null;
      const openModal = (title, msg, onOk) => {
        if (titleEl) titleEl.textContent = title || 'Confirm Action';
        if (msgEl) msgEl.textContent = msg || 'Are you sure?';
        pendingAction = onOk || null;
        if (modal) modal.classList.add('show');
      };
      const closeModal = () => { if (modal) modal.classList.remove('show'); };
      if (okBtn && !okBtn.dataset.bound) {
        okBtn.addEventListener('click', async () => {
          const fn = pendingAction; pendingAction = null; closeModal(); if (typeof fn === 'function') await fn();
        });
        okBtn.dataset.bound = 'true';
      }
      if (cancelBtn && !cancelBtn.dataset.bound) {
        cancelBtn.addEventListener('click', () => { pendingAction = null; closeModal(); });
        cancelBtn.dataset.bound = 'true';
      }
      // Bind admin buttons using modal
      const btnAll = document.getElementById('admin-clear-all');
      const btnGl = document.getElementById('admin-clear-gl');
      const btnDocs = document.getElementById('admin-clear-docs');
      if (btnAll && !btnAll.dataset.bound) {
        btnAll.addEventListener('click', async () => {
          openModal('Delete ALL Data', 'Delete ALL data (GL + Images)? This cannot be undone.', async () => doCall('/api/admin/clear-all'));
        });
        btnAll.dataset.bound = 'true';
      }
      if (btnGl && !btnGl.dataset.bound) {
        btnGl.addEventListener('click', async () => {
          openModal('Delete GL', 'Delete all GL entries? This cannot be undone.', async () => doCall('/api/admin/clear-gl'));
        });
        btnGl.dataset.bound = 'true';
      }
      if (btnDocs && !btnDocs.dataset.bound) {
        btnDocs.addEventListener('click', async () => {
          openModal('Delete Images', 'Delete all documents/images? This cannot be undone.', async () => doCall('/api/admin/clear-docs'));
        });
        btnDocs.dataset.bound = 'true';
      }
    } catch (_) {}
  }

  async refreshDocsSummary() {
    try {
      if (!this.apiBaseUrl) return;
      const data = await listDocItems(this.apiBaseUrl);
      this.docs.items = data.items || [];
      this.docs.links = data.links || [];
      this.docs.documents = data.documents || [];
      if (this.docs.summaryEl) {
        const linked = this.docs.links.length;
        const total = this.docs.items.length;
        this.docs.summaryEl.textContent = `Items parsed: ${total}. Linked: ${linked}.`;
      }
      // Render document classifications
      try {
        const host = document.getElementById('docs-class-list');
        if (host) {
          if (!this.docs.documents || this.docs.documents.length === 0) {
            host.innerHTML = '';
          } else {
            const rows = this.docs.documents.map((d) => {
              const t = d.doc_type || 'unknown';
              const ap = Array.isArray(d.approvals) ? d.approvals.length : 0;
              let first = '';
              if (ap > 0) {
                const a = d.approvals[0] || {};
                first = a.summary || [
                  (a.decision === 'rejected' ? 'Rejected' : (a.decision === 'approved' ? 'Approved' : 'Approval')),
                  a.approver ? `by ${a.approver}` : '',
                  a.title ? `(${a.title})` : '',
                  a.date ? `on ${a.date}` : ''
                ].filter(Boolean).join(' ');
              }
              const view = d.file_url || (d.id && d.filename ? (`/uploads/${encodeURIComponent(d.id)}/${encodeURIComponent(d.filename)}`) : '');
              return `<tr><td>${view ? `<a href="${view}" target="_blank" rel="noopener">${d.filename || ''}</a>` : (d.filename || '')}</td><td>${t}</td><td>${ap}</td><td>${first || ''}</td></tr>`;
            }).join('');
            host.innerHTML = `
              <div class="table-container">
                <table class="data-table">
                  <thead><tr><th>File</th><th>Detected Type</th><th>Approvals Found</th><th>First Approval</th></tr></thead>
                  <tbody>${rows}</tbody>
                </table>
              </div>`;
          }
        }
      } catch (_) {}
      // Render Attachments (non-receipt/invoice images)
      try {
        const gal = document.getElementById('attachments-gallery');
        if (gal) {
          const imgs = (this.docs.documents || []).filter(d => (d.doc_type !== 'receipt' && d.doc_type !== 'invoice') && /^image\//i.test(d.mime_type || ''));
          if (!imgs.length) { gal.innerHTML = '<div class="text-secondary">No attachments.</div>'; }
          else {
            gal.innerHTML = imgs.map(d => {
              const src = d.file_url || (d.id && d.filename ? (`/uploads/${encodeURIComponent(d.id)}/${encodeURIComponent(d.filename)}`) : '');
              const name = d.filename || '';
              return `<div style="border:1px solid #e5e7eb; border-radius:8px; padding:8px; background:#fff;">
                <a href="${src}" target="_blank" rel="noopener">
                  <img src="${src}" alt="${name}" style="max-width:100%; max-height:120px; object-fit:contain; display:block; margin:0 auto;" />
                </a>
                <div class="text-secondary" style="margin-top:6px; font-size:12px; word-break:break-word;">${name}</div>
              </div>`;
            }).join('');
          }
        }
      } catch (_) {}
    } catch (_) {}
  }

  async refreshRequirementsSummary() {
    try {
      if (!this.apiBaseUrl) return;
      const r = await getRequirements(this.apiBaseUrl);
      const map = new Map((r.rows || []).map(x => [String(x.id), x]));
      this.req = { rows: r.rows || [], map };
      try {
        const badge = document.getElementById('pending-count');
        if (badge) {
          const pending = (this.req.rows || []).filter(x => (x.receiptRequired || x.approvalRequired) && !x.hasReceipt).length;
          badge.textContent = `Pending: ${pending}`;
        }
      } catch (_) {}
      return r;
    } catch (_) { return null; }
  }

  computeApprovalState(row, reqRow) {
    try {
      const green = String(row.status || '').toUpperCase() === 'GREEN';
      const hasReceipt = !!reqRow?.hasReceipt;
      const hasApproval = !!reqRow?.hasApproval;
      if (hasReceipt && hasApproval) return 'FULL';
      if (green) return 'TENTATIVE';
      return 'PENDING';
    } catch (_) { return ''; }
  }

  bindQuickLinkButtons() {
    const tbody = document.getElementById('gl-table-body');
    if (!tbody) return;
    tbody.querySelectorAll('button.quick-link[data-gl-id]').forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.addEventListener('click', () => {
        const glId = btn.getAttribute('data-gl-id');
        this.openLinkModal(glId);
      });
      btn.dataset.bound = 'true';
    });
  }

  openLinkModal(glId) {
    const modal = document.getElementById('link-modal');
    const title = document.getElementById('link-title');
    const list = document.getElementById('link-list');
    const search = document.getElementById('link-search');
    const ok = document.getElementById('link-ok');
    const cancel = document.getElementById('link-cancel');
    if (!modal || !list || !ok || !cancel) return;
    const glRow = (this.glData || []).find(r => String(r.id) === String(glId)) || {};
    if (title) title.textContent = `Link Document to: ${[glRow.vendor, glRow.date, (glRow.amount!=null?('$'+glRow.amount):'')].filter(Boolean).join(' | ')}`;
    // Build options from docs state
    const items = this.docs.items || [];
    const scored = items.map((it) => {
      const amt = Number(it.amount || 0), glAmt = Number(glRow.amount || 0);
      const dAmt = Math.abs(amt - glAmt);
      const v1 = String(it.vendor || '').toLowerCase();
      const v2 = String(glRow.vendor || '').toLowerCase();
      const vMatch = v1 && v2 && (v1.includes(v2) || v2.includes(v1));
      // basic scoring aligned with server logic
      let s = (dAmt < 0.01 ? 6 : (dAmt <= 1 ? 4.5 : 0)) + (vMatch ? 2.5 : 0);
      const d1 = it.date ? new Date(it.date) : null; const d2 = glRow.date ? new Date(glRow.date) : null;
      if (d1 && d2) { const delta = Math.abs((d1 - d2)/(1000*60*60*24)); if (delta<=2) s += 1; else if (delta<=7) s += 0.5; }
      return { it, score: s };
    }).sort((a,b) => b.score - a.score);
    const render = (query) => {
      const q = String(query||'').toLowerCase();
      const filtered = scored.filter(({it}) => {
        if (!q) return true;
        const parts = [it.vendor, it.date, (it.amount!=null?String(it.amount):''), it.kind].map(x=>String(x||'').toLowerCase());
        return parts.some(p => p.includes(q));
      }).slice(0, 100);
      list.innerHTML = filtered.map(({it}, idx) => {
        const label = [it.vendor, it.date, (it.amount!=null?('$'+it.amount):''), it.kind||''].filter(Boolean).join(' | ');
        const best = idx === 0 ? '<span style="margin-left:6px; padding:2px 6px; border-radius:10px; background:#dcfce7; color:#166534; font-size:12px;">Best</span>' : '';
        return `<label class="checkbox-label" style="display:flex; align-items:center; gap:8px; padding:4px 0;">
          <input type="radio" name="link-choice" value="${it.id}" ${idx===0?'checked':''}>
          <span>${label}${best}</span>
        </label>`;
      }).join('') || '<div class="text-secondary">No matches.</div>';
    };
    render('');
    if (search && !search.dataset.bound) {
      search.addEventListener('input', () => render(search.value||''));
      search.dataset.bound = 'true';
    }
    const doClose = () => { modal.classList.remove('show'); };
    if (!ok.dataset.bound) {
      ok.addEventListener('click', async () => {
        const choice = list.querySelector('input[name="link-choice"]:checked');
        const docId = choice && choice.value;
        if (!docId) { alert('Select a document item to link.'); return; }
        try {
          await linkDocItem(this.apiBaseUrl, docId, glId);
          await this.refreshDocsSummary();
          await this.refreshRequirementsSummary();
          this.renderGLTable();
          this.updateDashboard();
          await this.renderUnmatchedList();
          doClose();
        } catch (err) {
          alert('Failed to link: ' + (err?.message || err));
        }
      });
      ok.dataset.bound = 'true';
    }
    if (!cancel.dataset.bound) {
      cancel.addEventListener('click', doClose);
      cancel.dataset.bound = 'true';
    }
    modal.classList.add('show');
  }

  populateLinkedSections() {
    const hostRows = document.querySelectorAll('.gl-linked[data-gl-id]');
    if (!hostRows || !hostRows.length) return;
    const links = this.docs.links || [];
    const items = this.docs.items || [];
    const documents = this.docs.documents || [];
    const glAll = this.glData || [];
    const glById = new Map(glAll.filter(g => g && g.id).map(g => [String(g.id), g]));
    const byGl = new Map();
    for (const l of links) {
      const k = String(l.gl_entry_id);
      const arr = byGl.get(k) || [];
      arr.push(l);
      byGl.set(k, arr);
    }
    const itemById = new Map(items.map(i => [String(i.id), i]));
    const docById = new Map(documents.map(d => [String(d.id), d]));
    hostRows.forEach((el) => {
      const glId = el.getAttribute('data-gl-id');
      const arr = byGl.get(String(glId)) || [];
      const htmlLinks = arr.map((lnk) => {
        const it = itemById.get(String(lnk.document_item_id)) || {};
        const doc = docById.get(String(it.document_id)) || {};
        const summary = [it.vendor, it.date, (it.amount != null ? ('$' + it.amount) : ''), it.kind || ''].filter(Boolean).join(' | ');
        const ac = Array.isArray(doc.approvals) ? doc.approvals.length : 0;
        const approvalsHtml = (doc.approvals || []).map(a => `<div class="text-secondary">${a.summary || ''}</div>`).join('');
        const viewUrl = doc.file_url || (doc.id && doc.filename ? (`/uploads/${encodeURIComponent(doc.id)}/${encodeURIComponent(doc.filename)}`) : '');
        const isImg = /^image\//i.test(doc.mime_type || '');
        const detailsId = `docdet-${String(it.id)}`;
        const details = `
          <div id="${detailsId}" class="doc-details" style="display:none; margin-top:6px;">
            <div class="text-secondary">Type: ${doc.doc_type || 'unknown'}${it.kind ? ` (${it.kind})` : ''}</div>
            <div class="text-secondary">${it.vendor ? `Merchant: ${it.vendor}` : ''} ${it.date ? ` | Date: ${it.date}` : ''} ${it.amount != null ? ` | Amount: $${it.amount}` : ''}</div>
            ${Array.isArray(it?.details?.lines) && it.details.lines.length ? (`
              <div class="table-container" style="margin-top:6px;">
                <table class="data-table"><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead>
                <tbody>
                  ${it.details.lines.map(l => `<tr><td>${l?.desc || ''}</td><td>${l?.qty ?? ''}</td><td>${l?.unit ?? ''}</td><td>${l?.total ?? ''}</td></tr>`).join('')}
                </tbody></table>
              </div>`): ''}
            ${ac ? `<div style="margin-top:6px;"><strong>Approvals</strong>${approvalsHtml}</div>` : ''}
            ${viewUrl ? (isImg ? `<div style="margin-top:6px;"><img src="${viewUrl}" alt="preview" style="max-width:100%; max-height:220px; object-fit:contain; border:1px solid #e5e7eb; border-radius:6px;"/></div>` : `<div style="margin-top:6px;"><a class="btn" target="_blank" rel="noopener" href="${viewUrl}">Open File</a></div>`) : ''}
          </div>`;
        return `<div class="controls-row" style="gap: 8px; align-items: flex-start; flex-direction: column; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px;">
          <div style="display:flex; gap:8px; width:100%; align-items:center;">
            <div style="flex:1; min-width:260px;">${summary}</div>
            <div class="text-secondary">Approvals: ${ac}</div>
            <button class="btn btn--outline" data-toggle-details="${detailsId}">Details</button>
            ${viewUrl ? `<a class=\"btn\" target=\"_blank\" rel=\"noopener\" href=\"${viewUrl}\">View</a>` : ''}
            <button class="btn btn--outline unlink-doc" data-doc-item-id="${it.id}" data-gl-id="${glId}">Unlink</button>
          </div>
          ${details}
        </div>`;
      }).join('');
      // Quick link UI (sorted by rough relevance to this GL row)
      const gl = glById.get(String(glId)) || {};
      const scored = items.map((it) => {
        const amt = Number(it.amount || 0), glAmt = Number(gl.amount || 0);
        const dAmt = Math.abs(amt - glAmt);
        const v1 = String(it.vendor || '').toLowerCase();
        const v2 = String(gl.vendor || '').toLowerCase();
        const vMatch = v1 && v2 && (v1.includes(v2) || v2.includes(v1));
        const score = (dAmt < 0.01 ? 5 : (dAmt <= 1 ? 3 : (dAmt <= 10 ? 1 : 0))) + (vMatch ? 2 : 0);
        return { it, score };
      }).sort((a, b) => b.score - a.score).slice(0, 75);
      const opts = scored.map(({ it }) => `<option value="${it.id}">${[it.vendor, it.date, (it.amount != null ? ('$' + it.amount) : ''), it.kind || ''].filter(Boolean).join(' | ')}</option>`).join('');
      const linkUI = `
        <div class="controls-row" style="gap:8px; align-items:center; margin-top:6px;">
          <select class="form-control doclink-select" data-gl-id="${glId}" style="min-width: 280px;">
            <option value="">— Link a parsed document item —</option>
            ${opts}
          </select>
          <button class="btn btn--primary add-link" data-gl-id="${glId}">Link</button>
          <button class="btn" data-auto-link="${glId}">Auto</button>
        </div>`;
      el.innerHTML = (htmlLinks || '<em class="text-secondary">No linked documents.</em>') + linkUI;
      // Bind detail toggles
      el.querySelectorAll('[data-toggle-details]').forEach((b) => {
        b.addEventListener('click', () => {
          const id = b.getAttribute('data-toggle-details');
          const d = document.getElementById(id);
          if (d) d.style.display = (d.style.display === 'none' ? '' : 'none');
        });
      });
    });
    // Bind unlink buttons
    document.querySelectorAll('.unlink-doc[data-doc-item-id]').forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.addEventListener('click', async () => {
        const di = btn.getAttribute('data-doc-item-id');
        const gid = btn.getAttribute('data-gl-id');
        try {
          await unlinkDocItem(this.apiBaseUrl, di, gid);
          // Refresh state and UI
          await this.refreshDocsSummary();
          await this.refreshRequirementsSummary();
          this.renderGLTable();
          this.updateDashboard();
        } catch (err) {
          alert('Failed to unlink: ' + (err?.message || err));
        }
      });
      btn.dataset.bound = 'true';
    });
    // Bind add-link buttons
    document.querySelectorAll('.add-link[data-gl-id]').forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.addEventListener('click', async () => {
        const glId = btn.getAttribute('data-gl-id');
        const host = btn.closest('.gl-linked');
        const sel = host ? host.querySelector('.doclink-select') : null;
        const docId = sel && sel.value;
        if (!docId) { alert('Select a document item to link.'); return; }
        try {
          await linkDocItem(this.apiBaseUrl, docId, glId);
          await this.refreshDocsSummary();
          await this.refreshRequirementsSummary();
          this.renderGLTable();
          this.updateDashboard();
          await this.renderUnmatchedList();
        } catch (err) {
          alert('Failed to link: ' + (err?.message || err));
        }
      });
      btn.dataset.bound = 'true';
    });
    // Bind auto-link buttons
    document.querySelectorAll('button[data-auto-link]').forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.addEventListener('click', async () => {
        const glId = btn.getAttribute('data-auto-link');
        const host = btn.closest('.gl-linked');
        const sel = host ? host.querySelector('.doclink-select') : null;
        if (!sel) { alert('No candidates available.'); return; }
        // Pick first option after placeholder
        const opt = Array.from(sel.options).find(o => o.value);
        const docId = opt && opt.value;
        if (!docId) { alert('No candidates available.'); return; }
        try {
          await linkDocItem(this.apiBaseUrl, docId, glId);
          await this.refreshDocsSummary();
          await this.refreshRequirementsSummary();
          this.renderGLTable();
          this.updateDashboard();
          await this.renderUnmatchedList();
        } catch (err) {
          alert('Failed to auto-link: ' + (err?.message || err));
        }
      });
      btn.dataset.bound = 'true';
    });
  }

  async updateDocsControlsEnabled() {
    try {
      const btn = document.getElementById('ingest-docs-btn');
      const input = document.getElementById('docs-input');
      const drop = document.getElementById('docs-dropzone');
      const msBtn = document.getElementById('ms-open-docs');
      let hasGL = (this.glData && this.glData.length > 0);
      if (!hasGL && this.apiBaseUrl) {
        const gl = await fetchGLEntries(this.apiBaseUrl, 1, 0);
        hasGL = Array.isArray(gl.rows) && gl.rows.length > 0;
      }
      const disabled = !hasGL;
      if (btn) btn.disabled = disabled;
      if (input) input.disabled = disabled;
      if (drop) drop.style.pointerEvents = disabled ? 'none' : '';
      if (drop) drop.style.opacity = disabled ? '0.5' : '';
      if (msBtn) msBtn.disabled = disabled;
      const statusEl = document.getElementById('docs-status');
      if (statusEl) statusEl.textContent = disabled ? 'Import GL first to enable document upload.' : '';
    } catch (_) {}
  }

  async renderUnmatchedList() {
    try {
      if (!this.apiBaseUrl) return;
      const cont = document.getElementById('unmatched-list');
      if (!cont) return;
      const req = await getRequirements(this.apiBaseUrl);
      const glResp = await fetchGLEntries(this.apiBaseUrl, 1000, 0);
      const glById = new Map((glResp.rows || []).map(r => [String(r.id), r]));
      const items = await listDocItems(this.apiBaseUrl);
      const allDocItems = items.items || [];
      const needing = (req.rows || []).filter(r => (r.receiptRequired || r.approvalRequired) && !r.hasReceipt);
      if (!needing.length) { cont.innerHTML = '<p class="text-secondary">All good: no unmatched items needing receipts/approvals.</p>'; return; }
      const options = allDocItems.map(d => `<option value="${d.id}">${[d.vendor, d.date, (d.amount != null ? ('$' + d.amount) : '')].filter(Boolean).join(' | ')}</option>`).join('');
      const rows = needing.map((n, idx) => {
        const g = glById.get(String(n.id)) || {};
        const label = [g.vendor, g.date, g.description, (g.amount != null ? ('$' + g.amount) : '')].filter(Boolean).join(' | ');
        return `
          <div class="controls-row" style="gap: 8px; align-items: center; margin-bottom: 6px;">
            <div style="flex: 1; min-width: 300px;">
              <strong>${label || 'GL Item'}</strong>
              <div class=\"text-secondary\">${(n.reasons || []).join('; ')}</div>
            </div>
            <div>
              <select id="docsel-${idx}" class="form-control" style="min-width: 280px;">
                <option value="">— Select parsed document item —</option>
                ${options}
              </select>
            </div>
            <div>
              <button class="btn btn--primary" data-link-idx="${idx}" data-gl-id="${n.id}">Link</button>
            </div>
          </div>`;
      }).join('');
      cont.innerHTML = rows;
      cont.querySelectorAll('button[data-link-idx]').forEach((b) => {
        b.addEventListener('click', async () => {
          const idx = b.getAttribute('data-link-idx');
          const glId = b.getAttribute('data-gl-id');
          const sel = document.getElementById(`docsel-${idx}`);
          const docId = sel && sel.value;
          if (!docId) { alert('Select a document item to link.'); return; }
          try {
            await linkDocItem(this.apiBaseUrl, docId, glId);
            await this.refreshDocsSummary();
            await this.refreshRequirementsSummary();
            await this.renderUnmatchedList();
          } catch (err) {
            alert('Failed to link: ' + (err?.message || err));
          }
        });
      });
    } catch (_) {}
  }

  // Settings UI removed.
}

document.addEventListener("DOMContentLoaded", () => {
  window.farApp = new FARComplianceApp();
  window.farApp.init();
});
