// POC - Audit Materials System - Complete App.js with Document Linking Modal
// Orchestrator (ES Modules)

import { auditAll, auditWithApprovalDetection } from "./modules/services/auditService.js";
import { readExcelFile, mapExcelRows, readExcelAsAOA, mapRowsFromAOA, detectHeaderRow } from "./modules/services/excelService.js";
import { normalizeGLSpreadsheet } from "./modules/services/apiService.js";
import { renderGLTable, filterData } from "./modules/ui/tableView.js";
import { updateDashboard as updateDashboardUI } from "./modules/ui/dashboard.js";
import { generateReport as genReport, exportToPDF as exportPDF } from "./modules/reports/reportService.js";
import { renderLogDashboard, initializeLogDashboard, destroyLogDashboard } from "./modules/ui/logDashboard.js";

import {
  saveGLEntries,
  serverLLMReview, serverLLMMapColumns,
  ingestDocuments, listDocItems, getRequirements, fetchGLEntries,
  linkDocItem, unlinkDocItem
} from "./modules/services/apiService.js";

import { farRules as builtinFarRules } from "./modules/data/farRules.js";

// Optional: filter out noisy extension warnings in console output
try {
  if (typeof window !== 'undefined' && window.console) {
    const originalConsole = window.console;
    window.console = {
      ...originalConsole,
      warn: (...args) => {
        try {
          const msg = args.map(a => (typeof a === 'string' ? a : '')).join(' ');
          if (msg.includes('deprecated') && msg.includes('content.js')) return;
        } catch (_) {}
        originalConsole.warn(...args);
      }
    };
  }
} catch (_) {}

class FARComplianceApp {
  constructor() {
    this.glData = [];
    this.auditResults = [];
    this.charts = {
      complianceChart: null,
      violationsChart: null,
      amountChart: null
    };
    this.uploadedFile = null;
    this.farRules = [];
    this.config = {};
    this.apiBaseUrl = null;
    this.azure = {
      endpoint: '',
      apiKey: '',
      deployment: '',
      apiVersion: '2024-06-01'
    };
    this.mappingState = {
      aoa: [],
      headers: [],
      headerRowIndex: 0
    };
    this.docs = {
      files: [],
      items: [],
      links: [],
      summaryEl: null,
      statusEl: null
    };
    this.req = {
      rows: [],
      map: new Map()
    };

    // Add document modal properties
    this.documentModal = {
      currentGLItem: null,
      // Document-level collections kept for existing UI
      availableDocuments: [],
      linkedDocumentIds: [],
      selectedDocumentIds: new Set(),
      // Item-level collections for accurate linking under the hood
      availableItems: [],
      documentsById: new Map(),
      linkedItemIds: [],
      selectedItemIds: new Set(),
      previewCache: new Map(),
      loading: false
    };

    // Track last refresh times to throttle tab-driven fetches
    this.lastRefresh = { gl: 0, docs: 0 };
  }

  async init() {
    try {
      await this.loadConfig();
      this.setupEventListeners();
      this.setupFileUpload();
      this.setupDocsUI();
      this.setupAdminUI();
      this.setupDocumentModal();

      // Safe loading with error handling
      try {
        await this.loadExistingGLData();
        await this.refreshDocsSummary();
        await this.refreshRequirementsSummary();
      } catch (error) {
        console.warn('Non-critical initialization error:', error);
        // Continue with empty data
        this.glData = [];
        this.auditResults = [];
      }

      this.renderGLTable();
      this.updateDashboard();

      // Safe async operations
      try {
        await this.updateDocsControlsEnabled();
        await this.updateLLMControlsEnabled();
      } catch (error) {
        console.warn('UI update error:', error);
      }

      console.log('✅ App initialized successfully');
    } catch (error) {
      console.error('❌ Critical initialization error:', error);
      this.showInitializationError(error);
    }
  }

  showInitializationError(error) {
    const container = document.querySelector('.container');
    if (container) {
      const errorDiv = document.createElement('div');
      errorDiv.style.cssText = `
        background: #fee2e2; color: #991b1b; 
        padding: 16px; border-radius: 8px; margin: 16px 0;
        border: 1px solid #fecaca;
      `;
      errorDiv.innerHTML = `
        <h3>⚠️ App Initialization Error</h3>
        <p>The application failed to start properly. Please:</p>
        <ul>
          <li>Check your internet connection</li>
          <li>Refresh the page</li>
          <li>Check browser console for details</li>
        </ul>
        <details>
          <summary>Technical Details</summary>
          <pre style="font-size: 12px; margin-top: 8px;">${error.message}</pre>
        </details>
      `;
      container.insertBefore(errorDiv, container.firstChild);
    }
  }

  async loadConfig() {
    try {
      this.farRules = builtinFarRules || [];

      try {
        const rr = await fetch('./config/farRules.json');
        if (rr.ok) {
          const ext = await rr.json();
          if (Array.isArray(ext) && ext.length) {
            const bySec = new Map((this.farRules || []).map(r => [r.section, r]));
            for (const r of ext) {
              if (r && r.section) bySec.set(r.section, r);
            }
            this.farRules = Array.from(bySec.values());
          }
        }
      } catch (_) {}

      const cfgRes = await fetch('./config/appConfig.json');
      if (cfgRes.ok) {
        const cfg = await cfgRes.json();
        if (cfg.apiBaseUrl) this.apiBaseUrl = cfg.apiBaseUrl;
      }

      // Fallbacks for when config is empty or we are running from file://
      if (!this.apiBaseUrl) {
        const loc = window.location;
        if (loc && /^https?:$/.test(loc.protocol)) {
          this.apiBaseUrl = loc.origin;
        } else {
          // Likely opened via file:// — use common dev server default
          this.apiBaseUrl = 'http://localhost:3000';
        }
      }

    } catch (e) {
      console.warn('Failed to load config. Using defaults.', e);
    }
  }

  async loadExistingGLData() {
    const perfStart = Date.now();
    try {
      if (this.apiBaseUrl) {
        console.log('Loading existing GL data from server...');
        const result = await fetchGLEntries(this.apiBaseUrl, 1000, 0);
        if (result && Array.isArray(result.rows) && result.rows.length > 0) {
          console.log(`📊 Found ${result.rows.length} GL entries on server, loading...`);
          this.glData = result.rows.map(row => ({
            id: row.id,
            accountNumber: row.account_number,
            description: row.description,
            amount: row.amount,
            date: row.date,
            category: row.category,
            vendor: row.vendor,
            contractNumber: row.contract_number,
            attachmentsCount: row.attachmentsCount || 0,
            hasReceipt: row.hasReceipt || false,
            approvalsCount: row.approvalsCount || 0,
            hasApproval: row.hasApproval || false,
            docSummary: row.doc_summary,
            docFlagUnallowable: row.doc_flag_unallowable,
            document_match_score: row.document_match_score || 0,
            documentMatchQuality: row.documentMatchQuality || ''
          }));
          console.log(`Loaded ${this.glData.length} existing GL entries from server`);
          this.logPerformance('Load Existing GL Data', perfStart, `${this.glData.length} rows`);

          // Run initial audit if FAR rules are loaded
          if (this.farRules && this.farRules.length > 0) {
            await this.runInitialAudit();
          }
        } else {
          // No data on server - preserve local data if it exists
          const localDataCount = this.glData?.length || 0;
          if (localDataCount > 0) {
            console.log(`📋 Server has no GL data, preserving ${localDataCount} local entries`);
          } else {
            console.log('📋 No GL data found on server or locally');
          }
          this.logPerformance('Load Existing GL Data', perfStart, `${localDataCount} local rows preserved`);
        }
      }
    } catch (e) {
      console.warn('Failed to load existing GL data:', e);
      this.logPerformance('Load Existing GL Data (failed)', perfStart);
    }
  }

  async runInitialAudit() {
    if (this.glData && this.glData.length > 0 && this.farRules && this.farRules.length > 0) {
      try {
        // Use enhanced audit with approval detection if documents are available
        if (this.docs && (this.docs.documents?.length > 0 || this.docs.items?.length > 0)) {
          console.log("Running enhanced audit with approval detection...");
          this.auditResults = await auditWithApprovalDetection(this.glData, this.farRules, this.docs, this.config);
          console.log("Enhanced audit completed with", this.auditResults.length, "results");
        } else {
          // Fallback to standard audit if no documents
          console.log("Running standard audit (no documents available for approval detection)...");
          this.auditResults = auditAll(this.glData, this.farRules, this.config);
          console.log("Standard audit completed with", this.auditResults.length, "results");
        }
      } catch (error) {
        console.warn("Enhanced audit failed, falling back to standard audit:", error.message);
        this.auditResults = auditAll(this.glData, this.farRules, this.config);
        console.log("Fallback audit completed with", this.auditResults.length, "results");
      }
    }
  }

  setupEventListeners() {
    console.log('🔗 Setting up event listeners...');

    const bindEvent = (elementId, eventType, handler, description) => {
      const element = document.getElementById(elementId);
      if (!element) {
        console.warn(`⚠️ Element not found: ${elementId}`);
        return false;
      }
      if (element.dataset.bound === 'true') {
        console.log(`ℹ️ Event already bound: ${elementId} ${eventType}`);
        return true;
      }
      element.addEventListener(eventType, (e) => {
        try { handler.call(this, e); } catch (error) {
          console.error(`❌ Event handler error (${elementId}):`, error);
          alert(`Error: ${error.message}`);
        }
      });
      element.dataset.bound = 'true';
      console.log(`✅ Bound ${eventType} to ${elementId}: ${description}`);
      return true;
    };

    bindEvent("run-audit-btn", "click", this.runAudit, "Run FAR audit");
    bindEvent("llm-review-btn", "click", this.runLLMReview, "Run LLM review");
    bindEvent("process-gl-btn", "click", this.handleProcessGL, "Process GL data");
    bindEvent("generate-report-btn", "click", this.generateReport, "Generate report");
    bindEvent("export-pdf-btn", "click", this.exportToPDF, "Export to PDF");
    bindEvent("azure-ocr-btn", "click", this.runAzureOCR, "Run Azure OCR");
    bindEvent("refresh-docs-btn", "click", this.refreshDocuments, "Refresh documents");
    bindEvent("debug-docs-btn", "click", this.debugDocuments, "Debug documents");

    document.querySelectorAll(".tab-btn").forEach((btn) => {
      if (btn.dataset.tabBound === 'true') return;
      btn.addEventListener("click", (e) => {
        try {
          e.preventDefault();
          const tabName = btn.getAttribute("data-tab");
          if (tabName) this.switchTab(tabName);
        } catch (error) {
          console.error('Tab switch error:', error);
        }
      });
      btn.dataset.tabBound = 'true';
    });

    // Setup subtab navigation
    document.querySelectorAll(".subtab-btn").forEach((btn) => {
      if (btn.dataset.subtabBound === 'true') return;
      btn.addEventListener("click", (e) => {
        try {
          e.preventDefault();
          const subtabName = btn.getAttribute("data-subtab");
          if (subtabName) this.switchSubtab(subtabName);
        } catch (error) {
          console.error('Subtab switch error:', error);
        }
      });
      btn.dataset.subtabBound = 'true';
    });

    const searchInput = document.getElementById("search-input");
    const severityFilter = document.getElementById("severity-filter");
    const pendingOnlyEl = document.getElementById('pending-only');
    if (searchInput) {
      const debouncedFilter = this.debounce(() => this.filterTable(), 300);
      searchInput.addEventListener("input", debouncedFilter);
    }
    if (severityFilter) {
      severityFilter.addEventListener("change", () => this.filterTable());
    }
    if (pendingOnlyEl && !pendingOnlyEl.dataset.bound) {
      pendingOnlyEl.addEventListener('change', () => this.filterTable());
      pendingOnlyEl.dataset.bound = 'true';
    }

    const glTable = document.getElementById("gl-table");
    if (glTable && !glTable.dataset.quickLinkBound) {
      glTable.addEventListener("click", (e) => {
        const linkButton = e.target.closest(".quick-link");
        if (linkButton && linkButton.dataset.glId) {
          e.preventDefault();
          this.openLinkModal(linkButton.dataset.glId);
        }
      });
      glTable.dataset.quickLinkBound = 'true';
    }

    console.log('✅ Event listeners setup complete');
  }

  handleProcessGL(e) {
    e.preventDefault();
    console.log('🔄 Processing GL data...');
    if (this.uploadedFile) {
      this.processUploadedFile();
    } else if (this.glData && this.glData.length > 0) {
      this.runAudit();
      this.switchTab("review");
    } else {
      alert("Please select an Excel file first or ensure GL data is loaded.");
    }
  }

  async checkServerHealth() {
    try {
      if (!this.apiBaseUrl) return false;
      const url = (this.apiBaseUrl || '').replace(/\/$/, '') + '/api/system/health';
      const res = await fetch(url, { cache: 'no-store' });
      return res.ok;
    } catch (_) {
      return false;
    }
  }

  async updateLLMControlsEnabled() {
    const llmBtn = document.getElementById('llm-review-btn');
    const hint = document.getElementById('llm-status-hint');
    if (!llmBtn) return;
    const online = await this.checkServerHealth();
    const hasImageAttachment = await this.hasAtLeastOneImageAttachment();
    const enabled = online && hasImageAttachment;
    llmBtn.disabled = !enabled;
    const msg = enabled
      ? ''
      : (!online
          ? 'Server offline: AI Review unavailable'
          : 'Attach at least one receipt/invoice image or PDF to a GL item');
    llmBtn.title = enabled ? 'AI Review' : msg;
    if (hint) {
      hint.textContent = msg;
      hint.style.display = enabled ? 'none' : '';
    }
  }

  async hasAtLeastOneImageAttachment() {
    try {
      // Prefer server truth if available
      if (this.apiBaseUrl) {
        const data = await listDocItems(this.apiBaseUrl);
        const docsById = new Map((data.documents || []).map(d => [String(d.id), d]));
        const itemsById = new Map((data.items || []).map(i => [String(i.id), i]));
        for (const l of (data.links || [])) {
          const item = itemsById.get(String(l.document_item_id));
          if (!item) continue;
          const doc = docsById.get(String(item.document_id));
          if (doc && typeof doc.mime_type === 'string') {
            const mt = doc.mime_type.toLowerCase();
            if (mt.startsWith('image/') || mt.includes('pdf')) return true;
          }
        }
        return false;
      }
      // Client-side fallback: check current table data
      const any = (this.glData || []).some(g => Array.isArray(g.linked_documents) && g.linked_documents.length > 0);
      return !!any;
    } catch (_) {
      return false;
    }
  }

  // Utility: debounce a function call
  debounce(fn, delay = 200) {
    let timer = null;
    return (...args) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  setupFileUpload() {
    const fileInput = document.getElementById("file-input");

    if (!fileInput) return;

    fileInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files.length > 0) {
        this.handleFileUpload(e.target.files[0]);
      }
    });
  }


  setupDocsUI() {
    const input = document.getElementById('docs-input');
    const btn = document.getElementById('ingest-docs-btn');
    const statusEl = document.getElementById('docs-status');
    const summaryEl = document.getElementById('docs-summary');
    
    this.docs.statusEl = statusEl;
    this.docs.summaryEl = summaryEl;

    const uploadBatches = async (files) => {
      const perfStart = Date.now();
      if (!this.apiBaseUrl) {
        if (statusEl) statusEl.textContent = 'Server not available. Ensure backend is running.';
        return;
      }

      const list = Array.from(files);
      if (!list.length) {
        if (statusEl) statusEl.textContent = 'No files selected.';
        if (this.showToast) this.showToast('No files selected.', 'warn');
        return;
      }

      try {
        const gl = await fetchGLEntries(this.apiBaseUrl, 1, 0);
        const count = Array.isArray(gl.rows) ? gl.rows.length : 0;
        if ((this.glData?.length || 0) === 0 && count === 0) {
          if (statusEl) statusEl.textContent = 'Please import GL entries before adding documents.';
          alert('Please import GL entries before adding documents.');
          return;
        }
      } catch (_) {}

      const chunk = 10;
      let linkedTotal = 0;
      let codexCount = 0;

      for (let i = 0; i < list.length; i += chunk) {
        const batch = list.slice(i, i + chunk);
        if (statusEl) statusEl.textContent = `Uploading ${i + 1}-${Math.min(i + batch.length, list.length)} of ${list.length}...`;
        
        try {
          const resp = await ingestDocuments(this.apiBaseUrl, batch);
          const links = (resp?.results || []).reduce((acc, r) => acc + (r?.links || []).length, 0);
          linkedTotal += Number(links) || 0;
          
          const codexResults = (resp?.results || []).filter(r => r.codexprocessing);
          codexCount += codexResults.length;
          // Handle duplicate notifications and optional replacement
          const duplicates = (resp?.results || []).filter(r => r && r.code && (r.code === 'DUPLICATE_NAME' || r.code === 'DUPLICATE_EXACT'));
          for (const d of duplicates) {
            if (d.code === 'DUPLICATE_EXACT') {
              if (this.showToast) this.showToast(`Already uploaded (exact match): ${d.filename}`, 'info');
              continue;
            }
            // Same name, different content -> ask user
            const toReplace = this.confirmAsync ? (await this.confirmAsync(`A document named "${d.filename}" already exists. Replace it?`)) : confirm(`A document named "${d.filename}" already exists. Replace it?`);
            if (toReplace) {
              const fileObj = batch.find(f => f.name === d.filename);
              if (fileObj) {
                try {
                  const replaceResp = await ingestDocuments(this.apiBaseUrl, [fileObj], { duplicateAction: 'replace' });
                  console.log('Replace response:', replaceResp);
                  if (this.showToast) this.showToast(`Replaced: ${d.filename}`, 'success');
                } catch (e) {
                  console.error('Replace failed for', d.filename, e);
                  if (this.showToast) this.showToast(`Failed to replace ${d.filename}: ${e?.message || e}`, 'error');
                }
              }
            }
          }
          
          if (codexResults.length > 0) {
            console.log('Codex enhanced processing used for', codexResults.length, 'documents', 
              codexResults.map(r => ({
                filename: r.filename,
                method: r.codexprocessing?.processingmethod,
                matches: r.codexprocessing?.matchesfound,
                confidence: r.codexprocessing?.confidencescores
              }))
            );
          }
        } catch (_) {}
      }

      const codexMsg = codexCount > 0 ? ` (${codexCount} enhanced with Codex OCR)` : '';
      if (statusEl) statusEl.textContent = `Parsed documents${codexMsg}.`;
      await this.refreshDocsSummary();
      await this.refreshRequirementsSummary();
      try { this.logPerformance('Docs Ingest', perfStart, `${list.length} files`); } catch (_) {}
      try { await this.updateLLMControlsEnabled(); } catch (_) {}
    };

    if (btn && input) {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          await uploadBatches(input.files);
        } catch (err) {
          if (statusEl) statusEl.textContent = 'Ingest failed.';
          alert('Failed to ingest docs: ' + (err?.message || err));
        }
      });
    }

    const drop = document.getElementById('docs-dropzone');
    if (drop) {
      ['dragenter', 'dragover'].forEach(ev => {
        drop.addEventListener(ev, (e) => {
          e.preventDefault();
          e.stopPropagation();
          drop.style.background = '#f1f5f9';
        });
      });
      
      ['dragleave', 'drop'].forEach(ev => {
        drop.addEventListener(ev, (e) => {
          e.preventDefault();
          e.stopPropagation();
          drop.style.background = '';
        });
      });
      
      drop.addEventListener('drop', async (e) => {
        const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
        const allowed = files.filter(f => /\.(pdf|png|jpg|jpeg|docx)$/i.test(f.name));
        
        try {
          await uploadBatches(allowed);
        } catch (err) {
          if (statusEl) statusEl.textContent = 'Ingest failed.';
          alert('Failed to ingest docs: ' + (err?.message || err));
        }
      });
    }
  }

  setupAdminUI() {
    try {
      const self = this; // Save reference to class instance
      const s = (msg) => {
        const el = document.getElementById('admin-status');
        if (el) el.textContent = msg || '';
      };

      const doCall = async (path) => {
        if (!self.apiBaseUrl) {
          s('Server not available.');
          throw new Error('Server not available.');
        }
        
        try {
          s('Working...');
          const url = this.apiBaseUrl.replace(/\/$/, '') + path;
          console.log('Delete request to:', url);
          const res = await fetch(url, { method: 'DELETE' });
          
          if (!res.ok) {
            const errorText = await res.text().catch(() => 'Unknown error');
            console.error('Delete request failed:', res.status, errorText);
            throw new Error(`Delete failed (${res.status}): ${errorText}`);
          }
          
          const result = await res.json().catch(() => ({}));
          console.log('Delete successful:', result);
          
          if (path.includes('clear-gl') || path.includes('clear-all')) {
            self.glData = [];
            self.auditResults = [];
          }
          if (path.includes('clear-docs') || path.includes('clear-all')) {
            self.docs = { ...self.docs, items: [], links: [], documents: [] };
          }
          
          await self.refreshDocsSummary();
          await self.refreshRequirementsSummary();
          self.renderGLTable();
          self.updateDashboard();
          await self.renderUnmatchedList();
          try { await self.updateDocsControlsEnabled(); } catch (_) {}

          // Refresh upload files lists in Upload & Process tab
          try {
            if (typeof window.loadUploadedFiles === 'function') {
              await window.loadUploadedFiles();
            } else if (typeof window.loadGLFiles === 'function' && typeof window.loadDocumentFiles === 'function') {
              await window.loadGLFiles();
              await window.loadDocumentFiles();
            }
          } catch (e) {
            console.warn('Failed to refresh upload files lists:', e);
          }
          
          s('Done.');
        } catch (error) {
          s('Delete failed.');
          console.error('doCall error:', error);
          throw error;
        }
      };

      const modal = document.getElementById('confirm-modal');
      const titleEl = document.getElementById('confirm-title');
      const msgEl = document.getElementById('confirm-message');
      const okBtn = document.getElementById('confirm-ok');
      const cancelBtn = document.getElementById('confirm-cancel');
      let pendingAction = null;

      const openModal = (title, msg, onOk) => {
        console.log('Opening modal with title:', title);
        if (titleEl) titleEl.textContent = title || 'Confirm Action';
        if (msgEl) msgEl.textContent = msg || 'Are you sure?';
        pendingAction = onOk || null;
        if (modal) {
          modal.style.display = '';
          modal.classList.add('show');
          console.log('Modal should now be visible, classes:', modal.classList);
          console.log('Modal style display:', modal.style.display);
        }
      };

      const closeModal = () => {
        if (modal) {
          modal.classList.remove('show');
        }
      };

      if (modal && !modal.dataset.bound) {
        modal.addEventListener('click', e => {
          if (e.target.closest('.modal-close') || e.target === modal) {
            closeModal();
          }
        });
        modal.dataset.bound = 'true';
      }

      if (okBtn && !okBtn.dataset.bound) {
        console.log('Binding OK button click handler');
        okBtn.addEventListener('click', async (e) => {
          console.log('OK button clicked!', e);
          e.preventDefault();
          e.stopPropagation();
          const fn = pendingAction;
          pendingAction = null;
          closeModal();
          if (typeof fn === 'function') {
            try {
              await fn();
            } catch (err) {
              console.error('Delete operation failed:', err);
              s('Delete failed: ' + (err.message || err));
              alert('Delete failed: ' + (err.message || err));
            }
          }
        });
        okBtn.dataset.bound = 'true';
      }

      if (cancelBtn && !cancelBtn.dataset.bound) {
        console.log('Binding Cancel button click handler');
        cancelBtn.addEventListener('click', (e) => {
          console.log('Cancel button clicked!', e);
          e.preventDefault();
          e.stopPropagation();
          pendingAction = null;
          closeModal();
        });
        cancelBtn.dataset.bound = 'true';
      }

      const btnAll = document.getElementById('admin-clear-all');
      const btnGl = document.getElementById('admin-clear-gl');
      const btnDocs = document.getElementById('admin-clear-docs');

      if (btnAll && !btnAll.dataset.bound) {
        btnAll.addEventListener('click', async () => {
          openModal('Delete ALL Data', 'Delete ALL data (GL + Images)? This cannot be undone.', 
            async () => doCall('/api/admin/clear-all'));
        });
        btnAll.dataset.bound = 'true';
      }

      if (btnGl && !btnGl.dataset.bound) {
        btnGl.addEventListener('click', async () => {
          openModal('Delete GL', 'Delete all GL entries? This cannot be undone.', 
            async () => doCall('/api/admin/clear-gl'));
        });
        btnGl.dataset.bound = 'true';
      }

      if (btnDocs && !btnDocs.dataset.bound) {
        btnDocs.addEventListener('click', async () => {
          openModal('Delete Images', 'Delete all documents/images? This cannot be undone.', 
            async () => doCall('/api/admin/clear-docs'));
        });
        btnDocs.dataset.bound = 'true';
      }

    } catch (_) {}
  }

  // DOCUMENT MODAL METHODS

  setupDocumentModal() {
    const searchInput = document.getElementById('modal-doc-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', () => this.filterModalDocuments());
    }

    const typeFilter = document.getElementById('doc-type-filter');
    if (typeFilter) {
      typeFilter.addEventListener('change', () => this.filterModalDocuments());
    }

    const modal = document.getElementById('document-link-modal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.closest('.modal-close')) {
          this.closeLinkModal();
        }
        if (e.target.closest('#modal-cancel-btn')) {
          this.closeLinkModal();
        }
        if (e.target.closest('#modal-refresh-btn')) {
          this.refreshModalDocuments();
        }
        if (e.target.closest('#modal-save-btn')) {
          this.saveLinkChanges();
        }
        const removeBtn = e.target.closest('.remove-link');
        if (removeBtn && removeBtn.dataset.docId) {
          this.removeLinkFromSelection(removeBtn.dataset.docId);
        }
      });

      const docListContainer = document.getElementById('available-documents');
      if (docListContainer) {
        docListContainer.addEventListener('click', (e) => {
          const docItem = e.target.closest('.document-item');
          if (docItem && docItem.dataset.docId) {
            this.toggleDocumentSelection(docItem.dataset.docId);
          }
        });
      }
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && modal.style.display !== 'none') {
        this.closeLinkModal();
      }
    });
  }

  async openLinkModal(glId) {
    console.log('Opening document link modal for GL item:', glId);
    
    const glItem = this.auditResults.find(item => String(item.id) === String(glId)) ||
                  this.glData.find(item => String(item.id) === String(glId));
    
    if (!glItem) {
      console.error('GL item not found:', glId);
      alert('GL item not found');
      return;
    }
    
    this.documentModal.currentGLItem = glItem;
    this.documentModal.selectedDocumentIds.clear();
    
    const modal = document.getElementById('document-link-modal');
    if (!modal) {
      console.error('Document link modal not found in DOM');
      return;
    }
    
    modal.style.display = '';
    modal.classList.add('show');
    
    this.populateGLItemDetails(glItem);
    this.documentModal.loading = true;
    this.renderModalDocuments();
    await this.loadDocumentsAndLinks();
    this.documentModal.loading = false;
    this.renderModalDocuments();
  }

  closeLinkModal() {
    const modal = document.getElementById('document-link-modal');
    if (modal) {
      modal.classList.remove('show');
    }
    
    this.clearDocumentPreview();
    this.documentModal.currentGLItem = null;
    this.documentModal.selectedDocumentIds.clear();
  }

  populateGLItemDetails(glItem) {
    const detailsContainer = document.getElementById('gl-item-details');
    if (!detailsContainer) return;

    const parseClientAmount = (val) => {
      if (val == null) return 0;
      if (typeof val === 'number' && Number.isFinite(val)) return val;
      let s = String(val).trim();
      if (!s) return 0;
      let neg = false;
      if (/^\(.+\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
      s = s.replace(/[\$€£¥₹,\s]/g, '');
      if (/^\d+,\d+$/.test(s)) s = s.replace(',', '.');
      const n = Number(s);
      return Number.isFinite(n) ? (neg ? -n : n) : 0;
    };

    const details = [
      { label: 'Account', value: glItem.accountNumber || 'N/A' },
      { label: 'Description', value: glItem.description || 'N/A' },
      { label: 'Amount', value: (glItem.amount != null && glItem.amount !== '') ? `$${parseClientAmount(glItem.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : 'N/A' },
      { label: 'Date', value: glItem.date || 'N/A' },
      { label: 'Vendor', value: glItem.vendor || 'N/A' },
      { label: 'Category', value: glItem.category || 'N/A' },
      { label: 'Status', value: glItem.status || 'PENDING' }
    ];

    detailsContainer.innerHTML = details.map(detail => `
      <div class="item-detail">
        <strong>${detail.label}</strong>
        <span>${detail.value}</span>
      </div>
    `).join('');
  }

  async loadDocumentsAndLinks() {
    const perfStart = Date.now();
    try {
      const docsData = await listDocItems(this.apiBaseUrl);
      const documents = docsData.documents || [];
      const items = docsData.items || [];
      const links = docsData.links || [];

      // Index documents for preview/metadata and populate collections expected by UI
      this.documentModal.availableDocuments = documents.map(doc => ({
        ...doc,
        doctype: doc.doc_type || doc.doctype || 'other',
        mimetype: doc.mime_type || doc.mimetype,
        size: doc.meta?.size || doc.size || 0,
        uploadDate: doc.created_at || doc.uploadDate
      }));
      this.documentModal.documentsById = new Map(this.documentModal.availableDocuments.map(d => [String(d.id), d]));
      this.documentModal.availableItems = items;

      // Compute linked item IDs and derive the set of linked document IDs for this GL row
      const glId = String(this.documentModal.currentGLItem?.id || '');
      this.documentModal.linkedItemIds = links
        .filter(l => String(l.gl_entry_id) === glId)
        .map(l => String(l.document_item_id));
      this.documentModal.selectedItemIds = new Set(this.documentModal.linkedItemIds);

      const linkedDocIds = new Set();
      for (const it of items) {
        if (this.documentModal.selectedItemIds.has(String(it.id))) {
          linkedDocIds.add(String(it.document_id));
        }
      }
      this.documentModal.linkedDocumentIds = Array.from(linkedDocIds);
      this.documentModal.selectedDocumentIds = new Set(this.documentModal.linkedDocumentIds);

      console.log('Loaded docs:', this.documentModal.availableDocuments.length, 'items:', this.documentModal.availableItems.length);
      console.log('Linked item IDs:', this.documentModal.linkedItemIds);
      this.logPerformance('Load Documents & Links', perfStart, `${this.documentModal.availableDocuments.length} docs / ${this.documentModal.availableItems.length} items`);
    } catch (error) {
      console.error('Error loading documents:', error);
      this.documentModal.availableDocuments = [];
      this.documentModal.linkedDocumentIds = [];
      this.logPerformance('Load Documents & Links (failed)', perfStart);
    }
  }

  renderModalDocuments() {
    const container = document.getElementById('available-documents');
    if (!container) return;

    if (this.documentModal.loading) {
      container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:200px;color:#6b7280;gap:10px;">
          <span class="spinner" style="width:18px;height:18px;border:2px solid #e5e7eb;border-top-color:#3b82f6;border-radius:50%;display:inline-block;animation:spin 1s linear infinite"></span>
          <span>Loading documents...</span>
        </div>
      `;
      return;
    }

    const filteredDocs = this.getFilteredModalDocuments();
    
    if (!filteredDocs.length) {
      container.innerHTML = '<div class="no-documents">No documents available</div>';
      return;
    }

    container.innerHTML = filteredDocs.map(doc => {
      const isLinked = this.documentModal.linkedDocumentIds.includes(doc.id);
      const isSelected = this.documentModal.selectedDocumentIds.has(doc.id);
      
      const docType = doc.doctype || 'other';
      const fileSize = doc.size ? this.formatFileSize(doc.size) : '';
      
      return `
        <div class="document-item ${isSelected ? 'selected' : ''} ${isLinked ? 'linked' : ''}" 
             data-doc-id="${doc.id}">
          <input type="checkbox" class="document-checkbox" 
                 ${isSelected ? 'checked' : ''} />
          <div class="document-info">
            <div class="document-name">${doc.filename}</div>
            <div class="document-meta">
              ${fileSize} - ${doc.mimetype || 'Unknown type'}
              ${doc.uploadDate ? `- ${new Date(doc.uploadDate).toLocaleDateString('en-US')}` : ''}
            </div>
          </div>
          <span class="document-type-badge ${docType}">${docType}</span>
        </div>
      `;
    }).join('');
    
    this.renderLinkedDocuments();
  }

  renderLinkedDocuments() {
    const container = document.getElementById('linked-documents-list');
    if (!container) return;

    const linkedDocs = this.documentModal.availableDocuments.filter(doc => 
      this.documentModal.selectedDocumentIds.has(doc.id)
    );

    if (!linkedDocs.length) {
      container.innerHTML = '<div class="no-linked">No documents linked</div>';
      return;
    }

    container.innerHTML = linkedDocs.map(doc => `
      <div class="linked-item">
        <span>${doc.filename}</span>
        <button class="remove-link" data-doc-id="${doc.id}"
                title="Remove link">&times;</button>
      </div>
    `).join('');
  }

  getFilteredModalDocuments() {
    const searchTerm = document.getElementById('modal-doc-search-input')?.value.toLowerCase() || '';
    const typeFilter = document.getElementById('doc-type-filter')?.value || '';

    return this.documentModal.availableDocuments.filter(doc => {
      const matchesSearch = !searchTerm || 
        doc.filename.toLowerCase().includes(searchTerm) ||
        (doc.description && doc.description.toLowerCase().includes(searchTerm));
      
      const matchesType = !typeFilter || doc.doctype === typeFilter;
      
      return matchesSearch && matchesType;
    });
  }

  filterModalDocuments() {
    this.renderModalDocuments();
  }

  toggleDocumentSelection(docId) {
    if (this.documentModal.selectedDocumentIds.has(docId)) {
      this.documentModal.selectedDocumentIds.delete(docId);
    } else {
      this.documentModal.selectedDocumentIds.add(docId);
    }
    
    this.renderModalDocuments();
    this.showDocumentPreview(docId);
  }

  removeLinkFromSelection(docId) {
    this.documentModal.selectedDocumentIds.delete(docId);
    this.renderModalDocuments();
    this.clearDocumentPreview();
  }

  async showDocumentPreview(docId) {
    const previewArea = document.getElementById('document-preview-area');
    if (!previewArea) return;

    const doc = this.documentModal.availableDocuments.find(d => d.id === docId);
    if (!doc) {
      previewArea.innerHTML = '<div class="preview-error">Document not found</div>';
      return;
    }

    previewArea.innerHTML = '<div class="preview-placeholder">Loading preview...</div>';

    try {
      if (this.documentModal.previewCache.has(docId)) {
        this.displayPreview(this.documentModal.previewCache.get(docId), doc);
        return;
      }

      const previewUrl = this.getDocumentUrl(doc);
      
      if (this.isImageFile(doc.filename)) {
        const previewData = {
          type: 'image',
          url: previewUrl,
          filename: doc.filename
        };
        
        this.documentModal.previewCache.set(docId, previewData);
        this.displayPreview(previewData, doc);
        
      } else if (this.isPdfFile(doc.filename)) {
        const previewData = {
          type: 'pdf',
          url: previewUrl,
          filename: doc.filename
        };
        
        this.documentModal.previewCache.set(docId, previewData);
        this.displayPreview(previewData, doc);
        
      } else {
        const previewData = {
          type: 'info',
          filename: doc.filename,
          size: doc.size,
          mimetype: doc.mimetype
        };
        
        this.displayPreview(previewData, doc);
      }
      
    } catch (error) {
      console.error('Error loading preview:', error);
      previewArea.innerHTML = '<div class="preview-error">Error loading preview</div>';
    }
  }

  displayPreview(previewData, doc) {
    const previewArea = document.getElementById('document-preview-area');
    if (!previewArea) return;

    switch (previewData.type) {
      case 'image':
        previewArea.innerHTML = `
          <div style="text-align: center;">
            <img class="preview-image" src="${previewData.url}" alt="${previewData.filename}" 
                 onerror="this.parentElement.innerHTML='<div class=\\'preview-error\\'>Failed to load image</div>'" />
            <div style="margin-top: 10px; font-size: 12px; color: #6b7280;">
              ${previewData.filename}
            </div>
          </div>
        `;
        break;
        
      case 'pdf':
        previewArea.innerHTML = `
          <div style="text-align: center;">
            <iframe src="${previewData.url}" width="100%" height="300" 
                    style="border: 1px solid #e5e7eb; border-radius: 4px;">
              <p>PDF preview not supported. <a href="${previewData.url}" target="_blank">Open in new tab</a></p>
            </iframe>
            <div style="margin-top: 10px; font-size: 12px; color: #6b7280;">
              ${previewData.filename}
            </div>
          </div>
        `;
        break;
        
      case 'info':
        previewArea.innerHTML = `
          <div class="preview-info" style="padding: 20px; text-align: center;">
            <div style="font-size: 48px; color: #d1d5db; margin-bottom: 10px;">DOC</div>
            <div style="font-weight: 500; margin-bottom: 8px;">${previewData.filename}</div>
            <div style="color: #6b7280; font-size: 14px;">
              ${previewData.mimetype || 'Unknown type'}
              ${previewData.size ? ` - ${this.formatFileSize(previewData.size)}` : ''}
            </div>
            <div style="margin-top: 16px;">
              <a href="${this.getDocumentUrl(doc)}" target="_blank" class="btn btn--outline">
                Open Document
              </a>
            </div>
          </div>
        `;
        break;
        
      default:
        previewArea.innerHTML = '<div class="preview-placeholder">Preview not available</div>';
    }
  }

  clearDocumentPreview() {
    const previewArea = document.getElementById('document-preview-area');
    if (previewArea) {
      previewArea.innerHTML = '<div class="preview-placeholder">Select a document to preview</div>';
    }
  }

  getDocumentUrl(doc) {
    if (doc.fileurl) {
      return doc.fileurl;
    }
    
    const baseUrl = this.apiBaseUrl || window.location.origin;
    return `${baseUrl}/uploads/${encodeURIComponent(doc.id)}/${encodeURIComponent(doc.filename)}`;
  }

  isImageFile(filename) {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    return imageExtensions.includes(ext);
  }

  isPdfFile(filename) {
    return filename.toLowerCase().endsWith('.pdf');
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // UI helpers: non-blocking toasts and async confirm
  showToast(message, type = 'info', duration = 4000) {
    try {
      const containerId = 'toast-container';
      let container = document.getElementById(containerId);
      if (!container) {
        container = document.createElement('div');
        container.id = containerId;
        container.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
        document.body.appendChild(container);
      }
      const el = document.createElement('div');
      el.textContent = message;
      el.style.cssText = 'padding:10px 14px;border-radius:6px;color:#fff;box-shadow:0 4px 10px rgba(0,0,0,0.15);font-size:13px;max-width:360px;';
      const colors = { success: '#16a34a', error: '#dc2626', warn: '#f59e0b', info: '#2563eb' };
      el.style.background = colors[type] || colors.info;
      container.appendChild(el);
      setTimeout(() => { try { el.remove(); } catch (_) {} }, duration);
    } catch (_) {}
  }

  confirmAsync(message) {
    return new Promise((resolve) => {
      try {
        const ok = window.confirm(message);
        resolve(!!ok);
      } catch (_) { resolve(false); }
    });
  }

  async saveLinkChanges() {
    if (!this.documentModal.currentGLItem) return;
    const perfStart = Date.now();

    try {
      const originalLinks = new Set(this.documentModal.linkedDocumentIds);
      const newLinks = this.documentModal.selectedDocumentIds;
      
      const toLink = [...newLinks].filter(id => !originalLinks.has(id));
      const toUnlink = [...originalLinks].filter(id => !newLinks.has(id));
      
      console.log('Saving link changes:', { toLink, toUnlink });
      
      for (const docId of toUnlink) {
        await this.unlinkDocument(this.documentModal.currentGLItem.id, docId);
      }
      
      for (const docId of toLink) {
        await this.linkDocument(this.documentModal.currentGLItem.id, docId);
      }
      
      this.documentModal.currentGLItem.linked_documents = [...newLinks];
      
      this.renderGLTable();

      const changeCount = toLink.length + toUnlink.length;
      if (changeCount > 0) {
        alert(`Successfully updated ${changeCount} document link(s).`);

        // Re-run audit to check for approval status changes
        try {
          console.log('Re-running audit after document linking...');
          await this.runInitialAudit();
          this.renderGLTable(); // Re-render table with updated audit results
          console.log('Audit completed after document linking');
        } catch (error) {
          console.warn('Failed to re-run audit after document linking:', error);
        }
      } else {
        alert('No changes were made.');
      }
      
      this.closeLinkModal();
      try { await this.updateLLMControlsEnabled(); } catch (_) {}
      this.logPerformance('Save Link Changes', perfStart, `${changeCount} updates`);
      
    } catch (error) {
      console.error('Error saving link changes:', error);
      alert('Error saving changes: ' + (error.message || error));
      this.logPerformance('Save Link Changes (failed)', perfStart);
    }
  }

  async refreshModalDocuments() {
    await this.loadDocumentsAndLinks();
    this.renderModalDocuments();
  }

  // END DOCUMENT MODAL METHODS

  async refreshDocsSummary() {
    const perfStart = Date.now();
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
      // Keep GL table in sync with latest link counts
      try { this.renderGLTable(); } catch (_) {}
      this.logPerformance('Refresh Docs Summary', perfStart, `${this.docs.items.length} items`);
    } catch (_) { this.logPerformance('Refresh Docs Summary (failed)', perfStart); }
  }

  async refreshRequirementsSummary() {
    const perfStart = Date.now();
    try {
      if (!this.apiBaseUrl) return;
      
      const r = await getRequirements(this.apiBaseUrl);
      const map = new Map(r.rows?.map(x => [String(x.id), x]) || []);
      this.req = { rows: r.rows || [], map };
      
      try {
        const badge = document.getElementById('pending-count');
        if (badge) {
          const pending = this.req.rows
            .filter(x => x.receiptRequired || x.approvalRequired || !x.hasReceipt).length;
          badge.textContent = `Pending: ${pending}`;
        }
      } catch (_) {}
      
      this.logPerformance('Refresh Requirements Summary', perfStart, `${this.req.rows.length} rows`);
      return r;
    } catch (_) {
      this.logPerformance('Refresh Requirements Summary (failed)', perfStart);
      return null;
    }
  }

  async updateDocsControlsEnabled() {
    // Match IDs used in index.html
    const uploadBtn = document.getElementById('ingest-docs-btn');
    const docInput = document.getElementById('docs-input');
    
    const hasGL = this.glData && this.glData.length > 0;
    
    if (uploadBtn) {
      uploadBtn.disabled = !hasGL;
      uploadBtn.title = hasGL ? 'Upload supporting documents' : 'Upload GL data first';
    }
    
    if (docInput) {
      docInput.disabled = !hasGL;
    }
  }

  handleFileUpload(file) {
    const name = (file.name || '').toLowerCase();
    if (!name.match(/\.(xlsx|xls|csv)$/i)) {
      alert('Please upload a spreadsheet file (.xlsx, .xls, .csv)');
      return;
    }

    const fileInfo = document.getElementById("file-info");
    const fileDetails = document.getElementById("file-details");

    if (fileInfo && fileDetails) {
      fileDetails.innerHTML = `
        <p><strong>File:</strong> ${file.name}</p>
        <p><strong>Size:</strong> ${(file.size / 1024).toFixed(2)} KB</p>
      `;
      fileInfo.classList.remove("hidden");
    } else if (fileInfo) {
      fileInfo.innerHTML = `
        <h4>File Information</h4>
        <p><strong>File:</strong> ${file.name}</p>
        <p><strong>Size:</strong> ${(file.size / 1024).toFixed(2)} KB</p>
      `;
      fileInfo.classList.remove("hidden");
    }

    this.uploadedFile = file;
  }

  async processUploadedFile() {
    const perfStart = Date.now();
    if (!this.uploadedFile) {
      alert("Please select a file first.");
      return;
    }

    const processingIndicator = document.getElementById("processing-indicator");
    try {
      if (processingIndicator) processingIndicator.classList.remove("hidden");

      console.log('📁 Processing file:', this.uploadedFile.name);
      let normalized = null;
      try {
        // Prefer server-side normalization (GPT + robust parsing)
        const resp = await normalizeGLSpreadsheet(this.apiBaseUrl, this.uploadedFile, { useLLM: true });
        normalized = resp.rows || [];
        console.log('✅ Server normalization produced rows:', normalized.length);
      } catch (e) {
        // Handle duplicate file errors
        if (e.code === 'DUPLICATE_FILE') {
          const allowOverride = confirm(
            `This exact Excel file has already been uploaded.\n\n` +
            `Previously uploaded: ${e.existingFile.filename}\n` +
            `Upload date: ${new Date(e.existingFile.uploadedAt).toLocaleDateString('en-US')}\n` +
            `Entries: ${e.existingFile.entryCount}\n\n` +
            `Do you want to proceed anyway?`
          );
          if (allowOverride) {
            try {
              const resp = await normalizeGLSpreadsheet(this.apiBaseUrl, this.uploadedFile, { useLLM: true, allowDuplicate: true });
              normalized = resp.rows || [];
              console.log('✅ Server normalization with override produced rows:', normalized.length);
            } catch (retryError) {
              console.warn('Server normalization with override failed:', retryError.message);
              throw retryError;
            }
          } else {
            console.log('User cancelled duplicate upload');
            return;
          }
        } else if (e.code === 'DUPLICATE_FILENAME') {
          const allowOverride = confirm(
            `A file with this name has already been uploaded, but with different content.\n\n` +
            `Previously uploaded: ${e.existingFile.filename}\n` +
            `Upload date: ${new Date(e.existingFile.uploadedAt).toLocaleDateString('en-US')}\n` +
            `Entries: ${e.existingFile.entryCount}\n\n` +
            `Do you want to replace it?`
          );
          if (allowOverride) {
            try {
              const resp = await normalizeGLSpreadsheet(this.apiBaseUrl, this.uploadedFile, { useLLM: true, allowDuplicate: true });
              normalized = resp.rows || [];
              console.log('✅ Server normalization with filename override produced rows:', normalized.length);
            } catch (retryError) {
              console.warn('Server normalization with filename override failed:', retryError.message);
              throw retryError;
            }
          } else {
            console.log('User cancelled filename duplicate upload');
            return;
          }
        } else {
          console.warn('Server normalization failed, falling back to client mapping:', e.message);
        }
      }

      if (!normalized) {
        // Fallback to client-side parser for XLSX-only
        if (typeof XLSX === 'undefined') {
          throw new Error('Excel processing library not loaded. Please refresh the page and try again.');
        }
        const jsonData = await readExcelFile(this.uploadedFile);
        console.log('📊 Raw Excel data:', jsonData.length, 'rows');
        normalized = mapExcelRows(jsonData);
      }

      this.glData = normalized;
      console.log('✅ Mapped GL data:', this.glData.length, 'entries');

      try {
        if (this.apiBaseUrl) {
          const result = await saveGLEntries(this.apiBaseUrl, this.glData);
          if (result && Array.isArray(result.ids)) {
            this.glData = this.glData.map((row, i) => ({ ...row, id: result.ids[i] || row.id }));
          }
        }
      } catch (serverError) {
        console.warn('Server save failed (continuing with local data):', serverError.message);
      }

      await this.runInitialAudit();
      this.renderGLTable();
      this.switchTab("review");
      alert(`✅ Successfully processed ${this.glData.length} GL entries.`);
      this.logPerformance('Excel Processing', perfStart, `${this.glData.length} rows`);
      try { await this.updateDocsControlsEnabled(); } catch (_) {}
    } catch (error) {
      console.error('❌ File processing error:', error);
      alert(`Processing failed: ${error.message}`);
    } finally {
      if (processingIndicator) processingIndicator.classList.add("hidden");
    }
  }

  isWeakMapping(data) {
    if (!Array.isArray(data) || data.length === 0) return true;
    
    const sample = data[0];
    const essentialFields = ['accountNumber', 'description', 'amount'];
    const mapped = essentialFields.filter(field => sample[field] != null);
    
    return mapped.length < 2;
  }

  async attemptAutoMappingFromAOA(aoa) {
    if (!Array.isArray(aoa) || aoa.length < 2) return false;

    try {
      const headerRowIndex = detectHeaderRow(aoa);
      if (headerRowIndex < 0) return false;

      const headers = aoa[headerRowIndex] || [];
      const mapping = this.autoDetectMapping(headers);
      
      if (!mapping || Object.keys(mapping).length < 2) return false;

      const dataRows = aoa.slice(headerRowIndex + 1);
      this.glData = mapRowsFromAOA(dataRows, mapping);
      
      return this.glData.length > 0;
    } catch (err) {
      console.warn('Auto-mapping failed:', err);
      return false;
    }
  }

  autoDetectMapping(headers) {
    const mapping = {};
    const patterns = {
      accountNumber: /account|acct|gl.*account/i,
      description: /description|desc|narrative|memo/i,
      amount: /amount|total|value|cost|price/i,
      date: /date|when|time/i,
      category: /category|type|class|group/i,
      vendor: /vendor|supplier|payee|company/i,
      contractNumber: /contract|agreement|po|purchase.*order/i
    };

    for (let i = 0; i < headers.length; i++) {
      const header = String(headers[i] || '').trim();
      
      for (const [field, pattern] of Object.entries(patterns)) {
        if (pattern.test(header) && !mapping[field]) {
          mapping[field] = i;
          break;
        }
      }
    }

    return mapping;
  }

  prepareMappingUI() {
    // Implementation would be here - omitted for brevity
    alert('Manual mapping UI would be shown here');
  }

  async runAudit() {
    const perfStart = Date.now();
    console.log("runAudit() called");
    console.log("GL Data length:", this.glData?.length || 0);
    console.log("FAR Rules length:", this.farRules?.length || 0);

    if (!this.glData || this.glData.length === 0) {
      alert("No GL data available. Please upload a file first.");
      return;
    }

    if (!this.farRules || this.farRules.length === 0) {
      console.warn("No FAR rules loaded");
      alert("No FAR rules configured. Please check your configuration.");
      return;
    }

    try {
      const processingIndicator = document.getElementById("processing-indicator");
      if (processingIndicator) {
        processingIndicator.classList.remove("hidden");
      }

      console.log("Running audit with:", {
        glDataCount: this.glData.length,
        farRulesCount: this.farRules.length,
        docsAvailable: !!(this.docs && (this.docs.documents?.length > 0 || this.docs.items?.length > 0)),
        config: this.config,
        sampleGLItem: this.glData[0]
      });

      try {
        // Use enhanced audit with approval detection if documents are available
        if (this.docs && (this.docs.documents?.length > 0 || this.docs.items?.length > 0)) {
          console.log("Running enhanced audit with approval detection...");
          this.auditResults = await auditWithApprovalDetection(this.glData, this.farRules, this.docs, this.config);
        } else {
          console.log("Running standard audit (no documents available)...");
          this.auditResults = auditAll(this.glData, this.farRules, this.config);
        }
      } catch (error) {
        console.warn("Enhanced audit failed, falling back to standard audit:", error.message);
        this.auditResults = auditAll(this.glData, this.farRules, this.config);
      }

      console.log("Audit completed. Results count:", this.auditResults.length);
      console.log("Sample audit result:", this.auditResults[0]);

      if (processingIndicator) {
        processingIndicator.classList.add("hidden");
      }

      this.renderGLTable();
      this.updateDashboard();

      const auditCount = this.auditResults.length;
      const redCount = this.auditResults.filter(r => r.status === 'RED').length;
      const yellowCount = this.auditResults.filter(r => r.status === 'YELLOW').length;
      const violationCount = redCount + yellowCount;

      const message = `Audit completed successfully!\n\nProcessed: ${auditCount} items\nRed Flags: ${redCount}\nYellow Flags: ${yellowCount}\nTotal Violations: ${violationCount}\n\nResults updated in the table below.`;
      alert(message);
      this.logPerformance('FAR Audit', perfStart, `${auditCount} items`);

      this.switchTab("review");

    } catch (error) {
      console.error("Audit error:", error);
      
      const processingIndicator = document.getElementById("processing-indicator");
      if (processingIndicator) {
        processingIndicator.classList.add("hidden");
      }
      
      alert("Error running audit: " + error.message);
      this.logPerformance('FAR Audit (failed)', perfStart);
    }
  }

  async runLLMReview() {
    const perfStart = Date.now();
    if (!this.apiBaseUrl) {
      alert('LLM review requires server API configuration.');
      return;
    }

    if (!this.glData || this.glData.length === 0) {
      alert('No GL data to review. Please upload data first.');
      return;
    }

    // Enforce: must have at least one image attached to a GL item
    const okAttach = await this.hasAtLeastOneImageAttachment();
    if (!okAttach) {
      alert('AI Review requires at least one image attached to a GL line item. Please ingest a receipt/invoice image and ensure it is linked.');
      try { await this.updateLLMControlsEnabled(); } catch (_) {}
      return;
    }

    try {
      const btn = document.getElementById('llm-review-btn');
      const orig = btn ? btn.textContent : '';
      if (btn) btn.textContent = 'Reviewing...';

      const result = await serverLLMReview(this.apiBaseUrl, this.glData);
      
      if (result && result.enhanced) {
        this.glData = result.enhanced;
        this.renderGLTable();
        alert('LLM review completed successfully.');
        this.logPerformance('AI Review', perfStart, `${this.glData.length} items enhanced`);
      } else {
        alert('LLM review completed but no enhancements were made.');
        this.logPerformance('AI Review', perfStart, 'no enhancements');
      }

      if (btn) btn.textContent = orig;
    } catch (err) {
      alert('AI review failed: ' + (err.message || err));
      this.logPerformance('AI Review (failed)', perfStart);
      const btn = document.getElementById('llm-review-btn');
      if (btn) btn.textContent = 'AI Review';
    }
  }

  renderGLTable() {
    const tableContainer = document.getElementById("gl-table");
    if (!tableContainer) return;

    try {
      const dataToRender = this.auditResults && this.auditResults.length > 0 
        ? this.auditResults 
        : this.glData;
      
      console.log("Rendering table with data:", dataToRender);
      console.log("Sample item:", dataToRender[0]);
      
      renderGLTable(dataToRender);
    } catch (error) {
      console.error("Error rendering GL table:", error);
      tableContainer.innerHTML = '<p style="color: red;">Error rendering table: ' + error.message + '</p>';
    }
  }

  filterTable() {
    const searchInput = document.getElementById("search-input");
    const severityFilter = document.getElementById("severity-filter");
    const pendingOnly = document.getElementById("pending-only");

    if (!searchInput || !severityFilter) return;

    const searchTerm = searchInput.value.toLowerCase();
    const severityValue = severityFilter.value;
    const pendingOnlyChecked = pendingOnly ? pendingOnly.checked : false;

    try {
      const sourceData = this.auditResults && this.auditResults.length > 0 
        ? this.auditResults 
        : this.glData;

      console.log("Filtering data:", sourceData);
      console.log("Filter criteria:", { searchTerm, severityValue, pendingOnlyChecked });

      const filteredData = filterData(sourceData, severityValue, searchTerm);

      console.log("Filtered data:", filteredData);

      renderGLTable(filteredData);
    } catch (error) {
      console.error("Error filtering table:", error);
    }
  }

  updateDashboard() {
    try {
      updateDashboardUI(this.auditResults, this.glData, this.charts);
    } catch (error) {
      console.error("Error updating dashboard:", error);
    }
  }

  switchTab(tabName) {
    document.querySelectorAll(".tab-content").forEach((tab) => {
      tab.classList.remove("active");
    });

    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.classList.remove("active");
    });

    const selectedTab = document.getElementById(`${tabName}-tab`);
    const selectedBtn = document.querySelector(`[data-tab="${tabName}"]`);

    if (selectedTab) selectedTab.classList.add("active");
    if (selectedBtn) selectedBtn.classList.add("active");

    if (tabName === "dashboard") {
      // Refresh GL data before rendering dashboard to show latest
      this.refreshGLView(true).catch(() => {});
    } else if (tabName === "logs") {
      this.initializeLogsTab();
    } else if (tabName === "review") {
      // Default to GL Data Review subtab
      this.switchSubtab("gl-review");
      // Ensure GL table is fresh when entering Review
      this.refreshGLView(false).catch(() => {});
    }
  }

  switchSubtab(subtabName) {
    console.log('🔄 Switching to subtab:', subtabName);

    // Hide all subtab contents
    document.querySelectorAll(".subtab-content").forEach((subtab) => {
      subtab.classList.remove("active");
    });

    // Remove active from all subtab buttons
    document.querySelectorAll(".subtab-btn").forEach((btn) => {
      btn.classList.remove("active");
    });

    // Show selected subtab
    const selectedSubtab = document.getElementById(`${subtabName}-subtab`);
    const selectedBtn = document.querySelector(`[data-subtab="${subtabName}"]`);

    if (selectedSubtab) {
      selectedSubtab.classList.add("active");
      console.log('✅ Activated subtab:', subtabName);
    } else {
      console.error('❌ Subtab not found:', `${subtabName}-subtab`);
    }

    if (selectedBtn) {
      selectedBtn.classList.add("active");
    } else {
      console.error('❌ Subtab button not found:', `[data-subtab="${subtabName}"]`);
    }

    // Load content for specific subtabs
    if (subtabName === "doc-review") {
      // Always refresh when switching to Document Review
      console.log('📄 Loading Document Review content...');
      this.loadDocumentReview();
    } else if (subtabName === "gl-review") {
      // Refresh GL table when switching to GL Review
      console.log('📊 GL Review subtab activated');
      this.refreshGLView(false).catch(() => {});
    }
  }

  // Refresh GL data from server and update dependent views
  async refreshGLView(light = false) {
    const perfStart = Date.now();
    try {
      const now = Date.now();
      if (now - (this.lastRefresh.gl || 0) >= 5000) {
        this.lastRefresh.gl = now;
        await this.loadExistingGLData();
      }
      this.renderGLTable();
      if (!light) this.updateDashboard();
      this.logPerformance('Refresh GL on tab switch', perfStart, `${this.glData?.length || 0} rows`);
    } catch (e) {
      console.warn('GL refresh on tab switch failed:', e);
      this.logPerformance('Refresh GL on tab switch (failed)', perfStart);
    }
  }

  async initializeLogsTab() {
    try {
      const container = document.getElementById("log-dashboard-container");
      if (container) {
        container.innerHTML = renderLogDashboard();
        await initializeLogDashboard();
      }
    } catch (error) {
      console.error("Failed to initialize logs tab:", error);
    }
  }

  generateReport() {
    const perfStart = Date.now();
    try {
      const reportOptions = {
        auditResults: this.auditResults,
        glData: this.glData,
        reportTitle: 'POC - Audit Materials Report',
        contractNumber: '',
        includeSummary: true,
        includeViolations: true,
        includeRecommendations: true,
      };
      const report = genReport(reportOptions);
      const reportContainer = document.getElementById("report-content");
      if (reportContainer) {
        reportContainer.innerHTML = report;
      }
      
      const reportPreview = document.getElementById("report-preview");
      if (reportPreview) {
        reportPreview.classList.remove("hidden");
      }
      
      this.switchTab("reports");
      this.logPerformance('Generate Report', perfStart);
    } catch (error) {
      alert("Error generating report: " + error.message);
      console.error("Report generation error:", error);
      this.logPerformance('Generate Report (failed)', perfStart);
    }
  }

  exportToPDF() {
    const perfStart = Date.now();
    try {
      exportPDF(this.glData, this.auditResults, this.farRules);
      this.logPerformance('Export PDF', perfStart);
    } catch (error) {
      alert("Error exporting to PDF: " + error.message);
      console.error("PDF export error:", error);
      this.logPerformance('Export PDF (failed)', perfStart);
    }
  }

  async renderUnmatchedList() {
    // Implementation omitted for brevity
  }

  async linkDocument(glId, docId) {
    const perfStart = Date.now();
    if (!glId || !docId) {
      throw new Error('GL ID and Document ID are required');
    }

    try {
      if (!this.apiBaseUrl) {
        throw new Error('API not configured for document linking');
      }

      // apiService expects (document_item_id, gl_entry_id). Translate document -> first item.
      let itemId = null;
      const itemsLocal = this.documentModal?.availableItems || [];
      const item = itemsLocal.find(i => String(i.document_id) === String(docId));
      if (item) itemId = item.id;
      if (!itemId) {
        // Fallback: fetch from API
        const data = await listDocItems(this.apiBaseUrl);
        const fallback = (data.items || []).find(i => String(i.document_id) === String(docId));
        if (fallback) itemId = fallback.id;
      }
      if (!itemId) throw new Error('No OCR item found for document');
      await linkDocItem(this.apiBaseUrl, itemId, glId);
      
      const glItem = this.glData.find(g => String(g.id) === String(glId));
      if (glItem) {
        glItem.linked_documents = glItem.linked_documents || [];
        if (!glItem.linked_documents.includes(docId)) {
          glItem.linked_documents.push(docId);
        }
      }
      this.logPerformance('Link Document', perfStart, `gl:${glId} doc:${docId}`);

    } catch (err) {
      this.logPerformance('Link Document (failed)', perfStart, `gl:${glId} doc:${docId}`);
      throw new Error('Failed to link document: ' + (err.message || err));
    }
  }

  async unlinkDocument(glId, docId) {
    const perfStart = Date.now();
    try {
      if (!this.apiBaseUrl) {
        throw new Error('API not configured for document unlinking');
      }

      // apiService expects (document_item_id, gl_entry_id). Translate document -> first item.
      let itemId = null;
      const itemsLocal = this.documentModal?.availableItems || [];
      const item = itemsLocal.find(i => String(i.document_id) === String(docId));
      if (item) itemId = item.id;
      if (!itemId) {
        // Fallback: fetch from API
        const data = await listDocItems(this.apiBaseUrl);
        const fallback = (data.items || []).find(i => String(i.document_id) === String(docId));
        if (fallback) itemId = fallback.id;
      }
      if (!itemId) throw new Error('No OCR item found for document');
      await unlinkDocItem(this.apiBaseUrl, itemId, glId);
      
      const glItem = this.glData.find(g => String(g.id) === String(glId));
      if (glItem && glItem.linked_documents) {
        glItem.linked_documents = glItem.linked_documents.filter(id => id !== docId);
      }
      this.logPerformance('Unlink Document', perfStart, `gl:${glId} doc:${docId}`);

    } catch (err) {
      this.logPerformance('Unlink Document (failed)', perfStart, `gl:${glId} doc:${docId}`);
      throw new Error('Failed to unlink document: ' + (err.message || err));
    }
  }

  async handleDocumentUpload(file) {
    if (!this.apiBaseUrl) {
      throw new Error('API not configured for document upload.');
    }

    const formData = new FormData();
    formData.append('files', file);

    const response = await fetch(`${this.apiBaseUrl}/api/documents/ingest`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }

    return await response.json();
  }

  async loadDocumentReview() {
    const perfStart = Date.now();
    try {
      await this.refreshDocsView(5000); // throttle to <5s between fetches
      this.setupDocumentFilters();
      this.logPerformance('Load Document Review', perfStart);
    } catch (error) {
      console.error('Error loading document review:', error);
      this.logPerformance('Load Document Review (failed)', perfStart);
    }
  }

  // Throttled docs refresh (default min interval: 5s)
  async refreshDocsView(minIntervalMs = 5000) {
    const now = Date.now();
    if (now - (this.lastRefresh.docs || 0) < minIntervalMs) {
      // Too soon; ensure current tables/metrics are rendered
      try { this.renderDocumentTable(); await this.updateDocumentMetrics(); } catch (_) {}
      return;
    }
    this.lastRefresh.docs = now;
    await this.refreshDocumentTable();
    await this.updateDocumentMetrics();
  }

  async refreshDocumentTable() {
    const perfStart = Date.now();
    try {
      console.log('🔄 Refreshing document table...');

      if (!this.apiBaseUrl) {
        console.warn('⚠️ No API base URL configured');
        return;
      }

      const data = await listDocItems(this.apiBaseUrl);
      console.log('📊 Raw API response:', {
        documents: data.documents?.length || 0,
        items: data.items?.length || 0,
        links: data.links?.length || 0
      });

      // Normalize document data to match frontend expectations
      this.docs.documents = (data.documents || []).map(doc => {
        const normalized = {
          ...doc,
          doctype: doc.doc_type || 'other',
          uploadDate: doc.created_at,
          size: doc.meta?.size || doc.size || 0,
          mimetype: doc.mime_type || doc.mimetype,
          // Ensure we have required fields
          id: doc.id,
          filename: doc.filename || 'Unknown',
          file_url: doc.file_url,
          text_content: doc.text_content,
          meta: doc.meta || {}
        };
        return normalized;
      });

      this.docs.items = data.items || [];
      this.docs.links = data.links || [];

      console.log('✅ Document data loaded:', {
        documents: this.docs.documents.length,
        items: this.docs.items.length,
        links: this.docs.links.length
      });

      // Always render the tables, even if empty
      this.renderDocumentTable();
      // Also refresh the GL table so the Linked Docs column/count stays accurate
      try { this.renderGLTable(); } catch (_) {}
      this.logPerformance('Refresh Document Table', perfStart, `${this.docs.documents.length} docs`);

    } catch (error) {
      console.error('❌ Error refreshing document table:', error);

      // Show error state in table
      const tableBody = document.getElementById('documents-table-body');
      if (tableBody) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="9" style="text-align: center; color: #ef4444; padding: 20px;">
              Error loading documents: ${error.message || error}
              <br><small>Check console for details</small>
            </td>
          </tr>
        `;
      }

      this.logPerformance('Refresh Document Table (failed)', perfStart);
    }
  }

  renderDocumentTable() {
    const tableBody = document.getElementById('documents-table-body');
    if (!tableBody) {
      console.error('❌ documents-table-body element not found!');
      return;
    }

    console.log('🎨 Rendering document table with', this.docs.documents.length, 'documents');

    if (!this.docs.documents.length) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; color: #6b7280; padding: 20px;">
            📄 No documents uploaded yet
            <br><small>Upload documents in the Documents tab to see them here</small>
          </td>
        </tr>
      `;
      return;
    }

    const filteredDocs = this.getFilteredDocuments();
    console.log('📋 Filtered documents for display:', filteredDocs.length);

    if (!filteredDocs.length) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; color: #6b7280; padding: 20px;">
            🔍 No documents match current filters
            <br><small>Try adjusting your search or filter criteria</small>
          </td>
        </tr>
      `;
      return;
    }

    try {
      tableBody.innerHTML = filteredDocs.map((doc, index) => {
        try {
          const linkedCount = this.getLinkedGLItemsCount(doc.id);
          const ocrStatus = this.getOCRStatus(doc);
          const confidence = this.getDocumentConfidence(doc);

          return `
            <tr data-doc-id="${doc.id}" data-index="${index}">
              <td>
                <div class="document-preview">
                  ${this.renderDocumentPreview(doc)}
                </div>
              </td>
              <td>
                <div class="document-name" title="${doc.filename}">${doc.filename}</div>
                <div class="document-meta" style="font-size: 12px; color: #6b7280;" title="${doc.id}">
                  ID: ${doc.id.substring(0, 8)}...
                </div>
              </td>
              <td>
                <span class="doc-type-badge ${doc.doctype || 'other'}" title="Document type">
                  ${doc.doctype || 'other'}
                </span>
              </td>
              <td>${this.formatFileSize(doc.size || 0)}</td>
              <td title="${doc.uploadDate}">
                ${doc.uploadDate ? new Date(doc.uploadDate).toLocaleDateString('en-US') : 'Unknown'}
              </td>
              <td>
                <span class="ocr-status ${ocrStatus.class}" title="${ocrStatus.description || ocrStatus.text}">
                  ${ocrStatus.text}
                </span>
              </td>
              <td>
                <span class="linked-count" title="Number of linked GL items">
                  ${linkedCount} item${linkedCount !== 1 ? 's' : ''}
                </span>
              </td>
              <td>
                <span class="confidence-score ${this.getConfidenceClass(confidence)}" title="OCR confidence score">
                  ${confidence}%
                </span>
              </td>
              <td>
                <div class="document-actions">
                  <button type="button" class="btn btn--small" onclick="window.app.openDocumentDetails('${doc.id}')" title="View details and OCR data">
                    Details
                  </button>
                  <button type="button" class="btn btn--small btn--outline" onclick="window.app.reprocessDocument('${doc.id}')" title="Reprocess with OCR">
                    Reprocess
                  </button>
                </div>
              </td>
            </tr>
          `;
        } catch (rowError) {
          console.error('❌ Error rendering document row:', doc.id, rowError);
          return `
            <tr>
              <td colspan="9" style="text-align: center; color: #ef4444; padding: 10px;">
                Error displaying document: ${doc.filename || doc.id}
              </td>
            </tr>
          `;
        }
      }).join('');

      console.log('✅ Document table rendered successfully');

    } catch (renderError) {
      console.error('❌ Error rendering document table:', renderError);
      tableBody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; color: #ef4444; padding: 20px;">
            Error rendering documents table
            <br><small>Check console for details</small>
          </td>
        </tr>
      `;
    }
  }

  renderDocumentPreview(doc) {
    if (this.isImageFile(doc.filename)) {
      const previewUrl = this.getDocumentUrl(doc);
      return `<img src="${previewUrl}" alt="${doc.filename}" style="width: 40px; height: 40px; object-fit: cover; border-radius: 4px;" onerror="this.style.display='none'">`;
    } else if (this.isPdfFile(doc.filename)) {
      return `<div class="pdf-icon" style="width: 40px; height: 40px; background: #ef4444; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: bold;">PDF</div>`;
    } else {
      return `<div class="doc-icon" style="width: 40px; height: 40px; background: #6b7280; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: bold;">DOC</div>`;
    }
  }

  getFilteredDocuments() {
    const searchTerm = document.getElementById('doc-search-input')?.value.toLowerCase() || '';
    const typeFilter = document.getElementById('doc-type-filter-review')?.value || '';
    const unprocessedOnly = document.getElementById('unprocessed-only')?.checked || false;

    return this.docs.documents.filter(doc => {
      const matchesSearch = !searchTerm ||
        doc.filename.toLowerCase().includes(searchTerm) ||
        (doc.text_content && doc.text_content.toLowerCase().includes(searchTerm));

      const matchesType = !typeFilter || (doc.doctype || 'other') === typeFilter;

      const matchesProcessed = !unprocessedOnly || !this.isDocumentProcessed(doc);

      return matchesSearch && matchesType && matchesProcessed;
    });
  }

  getLinkedGLItemsCount(docId) {
    // Links connect document_item_id to gl_entry_id
    // We need to find items that belong to this document, then count their links
    const documentItems = this.docs.items.filter(item => item.document_id === docId);
    const documentItemIds = documentItems.map(item => item.id);
    return this.docs.links.filter(link => documentItemIds.includes(link.document_item_id)).length;
  }

  getOCRStatus(doc) {
    const textLength = (doc.text_content || '').length;

    if (textLength > 100) {
      return {
        class: 'processed',
        text: 'Processed',
        description: `OCR completed (${textLength} chars extracted)`
      };
    } else if (textLength > 10) {
      return {
        class: 'processing',
        text: 'Partial',
        description: `Limited text extracted (${textLength} chars)`
      };
    } else if (doc.meta?.processing_method) {
      return {
        class: 'processing',
        text: 'Processing',
        description: `Method: ${doc.meta.processing_method}`
      };
    } else {
      return {
        class: 'pending',
        text: 'Pending',
        description: 'No OCR processing completed'
      };
    }
  }

  getDocumentConfidence(doc) {
    if (doc.meta && doc.meta.confidence) {
      return Math.round(doc.meta.confidence * 100);
    }
    return doc.text_content && doc.text_content.length > 10 ? 85 : 0;
  }

  getConfidenceClass(confidence) {
    if (confidence >= 80) return 'high';
    if (confidence >= 50) return 'medium';
    return 'low';
  }

  isDocumentProcessed(doc) {
    return doc.text_content && doc.text_content.length > 10;
  }

  async updateDocumentMetrics() {
    const totalDocs = this.docs.documents.length;
    const processedDocs = this.docs.documents.filter(doc => this.isDocumentProcessed(doc)).length;

    // Calculate linked documents correctly
    const linkedDocumentIds = new Set();
    this.docs.links.forEach(link => {
      const docItem = this.docs.items.find(item => item.id === link.document_item_id);
      if (docItem) {
        linkedDocumentIds.add(docItem.document_id);
      }
    });
    const linkedDocs = linkedDocumentIds.size;

    const pendingDocs = totalDocs - processedDocs;

    const elements = {
      'total-documents': totalDocs,
      'processed-documents': processedDocs,
      'linked-documents': linkedDocs,
      'pending-documents': pendingDocs
    };

    Object.entries(elements).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    });
  }

  setupDocumentFilters() {
    const searchInput = document.getElementById('doc-search-input');
    const typeFilter = document.getElementById('doc-type-filter-review');
    const unprocessedOnly = document.getElementById('unprocessed-only');

    if (searchInput && !searchInput.dataset.bound) {
      searchInput.addEventListener('input', this.debounce(() => {
        this.renderDocumentTable();
      }, 300));
      searchInput.dataset.bound = 'true';
    }

    if (typeFilter && !typeFilter.dataset.bound) {
      typeFilter.addEventListener('change', () => {
        this.renderDocumentTable();
      });
      typeFilter.dataset.bound = 'true';
    }

    if (unprocessedOnly && !unprocessedOnly.dataset.bound) {
      unprocessedOnly.addEventListener('change', () => {
        this.renderDocumentTable();
      });
      unprocessedOnly.dataset.bound = 'true';
    }
  }

  async runAzureOCR() {
    const perfStart = Date.now();
    const btn = document.getElementById('azure-ocr-btn');
    const statusHint = document.getElementById('ocr-status-hint');

    if (!this.apiBaseUrl) {
      alert('Azure OCR requires server API configuration.');
      return;
    }

    if (!this.docs.documents || this.docs.documents.length === 0) {
      alert('No documents available for OCR processing. Please upload documents first.');
      return;
    }

    try {
      if (btn) btn.textContent = 'Processing OCR...';
      if (statusHint) {
        statusHint.textContent = 'Running Tesseract OCR on all uploaded documents...';
        statusHint.style.display = '';
      }

      // Process all documents that haven't been processed yet
      const unprocessedDocs = this.docs.documents.filter(doc => !this.isDocumentProcessed(doc));

      if (unprocessedDocs.length === 0) {
        alert('All documents have already been processed.');
        return;
      }

      let processedCount = 0;
      let errorCount = 0;

      for (const doc of unprocessedDocs) {
        try {
          if (statusHint) {
            statusHint.textContent = `Processing ${processedCount + 1} of ${unprocessedDocs.length}: ${doc.filename}`;
          }

          // Call the reprocess endpoint for each document
          const response = await fetch(`${this.apiBaseUrl}/api/docs/reprocess`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              document_id: doc.id
            })
          });

          if (response.ok) {
            processedCount++;
            console.log(`Successfully processed: ${doc.filename}`);
          } else {
            errorCount++;
            console.error(`Failed to process: ${doc.filename}`);
          }
        } catch (error) {
          errorCount++;
          console.error(`Error processing ${doc.filename}:`, error);
        }
      }

      // Refresh the document data and table
      await this.refreshDocumentTable();
      await this.updateDocumentMetrics();

      const message = `OCR processing completed!\n\nProcessed: ${processedCount}\nErrors: ${errorCount}\nTotal: ${unprocessedDocs.length}`;
      alert(message);

      this.logPerformance('Azure OCR', perfStart, `${processedCount} docs processed`);

    } catch (error) {
      console.error('Azure OCR error:', error);
      alert('OCR processing failed: ' + (error.message || error));
      this.logPerformance('Azure OCR (failed)', perfStart);
    } finally {
      if (btn) btn.textContent = 'Run Azure OCR';
      if (statusHint) {
        statusHint.textContent = '';
        statusHint.style.display = 'none';
      }
    }
  }

  async refreshDocuments() {
    const perfStart = Date.now();
    try {
      await this.refreshDocumentTable();
      await this.updateDocumentMetrics();
      console.log('Documents refreshed successfully');
      alert('Documents refreshed successfully!');
      this.logPerformance('Refresh Documents', perfStart);
    } catch (error) {
      console.error('Error refreshing documents:', error);
      alert('Failed to refresh documents: ' + (error.message || error));
      this.logPerformance('Refresh Documents (failed)', perfStart);
    }
  }

  debugDocuments() {
    console.log('🐛 DEBUG: Document Review State');
    console.log('API Base URL:', this.apiBaseUrl);
    console.log('Documents:', this.docs.documents);
    console.log('Document Items:', this.docs.items);
    console.log('Links:', this.docs.links);
    console.log('Current Tab Active:', document.querySelector('#review-tab.active') ? 'YES' : 'NO');
    console.log('Current Subtab Active:', document.querySelector('#doc-review-subtab.active') ? 'YES' : 'NO');
    console.log('Table Body Element:', document.getElementById('documents-table-body'));

    const debugInfo = {
      apiBaseUrl: this.apiBaseUrl,
      documentsCount: this.docs.documents.length,
      itemsCount: this.docs.items.length,
      linksCount: this.docs.links.length,
      reviewTabActive: !!document.querySelector('#review-tab.active'),
      docReviewSubtabActive: !!document.querySelector('#doc-review-subtab.active'),
      tableBodyExists: !!document.getElementById('documents-table-body'),
      sampleDocument: this.docs.documents[0] || null
    };

    alert('Debug info logged to console. Check browser console for details.');
    console.table(debugInfo);
  }

  async viewDocument(docId) {
    const doc = this.docs.documents.find(d => d.id === docId);
    if (!doc) {
      alert('Document not found');
      return;
    }

    const url = this.getDocumentUrl(doc);
    window.open(url, '_blank');
  }

  openDocumentDetails(docId) {
    try {
      const modal = document.getElementById('document-details-modal');
      const content = document.getElementById('doc-details-content');
      if (!modal || !content) return this.viewDocument(docId);
      const doc = this.docs.documents.find(d => d.id === docId);
      if (!doc) return alert('Document not found');

      const docItems = this.docs.items.filter(it => it.document_id === docId);
      const itemIds = docItems.map(it => it.id);
      const links = this.docs.links.filter(l => itemIds.includes(l.document_item_id));
      const glRows = links.map(l => this.glData.find(g => String(g.id) === String(l.gl_entry_id))).filter(Boolean);

      const preview = this.isImageFile(doc.filename)
        ? `<img src="${this.getDocumentUrl(doc)}" alt="${doc.filename}" class="preview-image" onerror="this.style.display='none'">`
        : `<div class="pdf-icon" style="width:60px;height:60px;background:#ef4444;color:#fff;display:flex;align-items:center;justify-content:center;border-radius:6px;font-weight:bold;">${this.getFileExtension(doc.filename).toUpperCase().replace('.', '')}</div>`;

      const ocrSnippetRaw = (doc.text_content || '');
      const ocrSnippet = ocrSnippetRaw ? ocrSnippetRaw.slice(0, 500).replace(/</g, '&lt;') : '';
      const meta = doc.meta || {};

      // Derive parsed fields from associated items first; fallback to embedded JSON in text_content
      let parsed = { amount: null, date: null, merchant: null, currency: null };
      if (docItems.length) {
        const amt = docItems.map(i => Number(i.amount)).find(v => Number.isFinite(v));
        const dt = docItems.map(i => i.date).find(Boolean);
        const ven = docItems.map(i => i.vendor || i.merchant).find(Boolean);
        const cur = docItems.map(i => i.currency).find(Boolean) || 'USD';
        parsed = { amount: amt ?? null, date: dt || null, merchant: ven || null, currency: cur };
      } else if ((doc.text_content || '').startsWith('OCR extracted data:')) {
        try {
          const json = JSON.parse(doc.text_content.replace('OCR extracted data: ', ''));
          parsed = { amount: json.amount ?? null, date: json.date ?? null, merchant: json.merchant ?? null, currency: json.currency || null };
        } catch (_) {}
      }

      // Confidence fields intentionally omitted from UI per request

      const glList = glRows.length
        ? glRows.map(g => `<li>#${g.accountNumber || g.account_number || g.id} — ${this.truncateText(g.description || '', 80)} • $${Number(g.amount||0).toLocaleString('en-US',{minimumFractionDigits:2})} • ${g.date || ''}</li>`).join('')
        : '<li class="gl-details-muted">No GL rows linked</li>';

      // Parse full extracted data payload when present
      let ex = null;
      try {
        if ((doc.text_content || '').startsWith('OCR extracted data: ')) {
          ex = JSON.parse(doc.text_content.replace('OCR extracted data: ', ''));
        }
      } catch(_) {}

      function fmtVal(value, opts = {}) {
        if (value === null || value === undefined || value === '') return '—';
        if (opts.money && Number.isFinite(Number(value))) {
          return `$${Number(value).toLocaleString('en-US',{minimumFractionDigits:2})}`;
        }
        if (Array.isArray(value)) {
          return value.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ');
        }
        if (typeof value === 'object') {
          try { return JSON.stringify(value); } catch { return String(value); }
        }
        return String(value);
      }
      function kv(label, value, opts = {}) {
        return `<div><strong>${label}</strong><div>${fmtVal(value, opts)}</div></div>`;
      }

      content.innerHTML = `
        <div style="display:grid;grid-template-columns:180px 1fr;gap:16px;align-items:start;">
          <div>${preview}</div>
          <div>
            <div style="font-weight:600;">${doc.filename}</div>
            <div style="color:#6b7280;font-size:12px;">${this.formatFileSize(doc.size||0)} • ${doc.uploadDate ? new Date(doc.uploadDate).toLocaleDateString('en-US') : ''}</div>
            <div style="margin-top:8px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;">
              <div><strong>Method</strong><div>${meta.processing_method || meta.method || '—'}</div></div>
              <div><strong>Type</strong><div>${doc.doctype || 'other'}</div></div>
            </div>
            <div style="margin-top:8px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;">
              <div><strong>Parsed Amount</strong><div>${Number.isFinite(parsed.amount) ? `$${parsed.amount.toLocaleString('en-US',{minimumFractionDigits:2})}` : '—'}</div></div>
              <div><strong>Parsed Date</strong><div>${parsed.date || '—'}</div></div>
              <div><strong>Parsed Merchant</strong><div>${parsed.merchant ? String(parsed.merchant) : '—'}</div></div>
              <div><strong>Currency</strong><div>${parsed.currency || 'USD'}</div></div>
            </div>
            ${ex ? `
            <div style=\"margin-top:12px;\">
              <strong>Document Details</strong>
              <div class=\"gl-details-grid\" style=\"margin-top:6px;grid-template-columns:repeat(3,minmax(0,1fr));\">
                ${kv('Description', ex.description)}
                ${kv('Summary', ex.summary)}
                ${kv('Invoice ID', ex.invoiceId)}
                ${kv('Customer Name', ex.customerName)}
                ${kv('Billing Address', ex.billingAddress)}
                ${kv('Merchant Address', ex.merchantAddress)}
                ${kv('Merchant Phone', ex.merchantPhone)}
                ${kv('Receipt Type', ex.receiptType)}
                ${kv('Transaction Time', ex.transactionTime)}
                ${kv('Subtotal', ex.subtotal ?? ex.subTotal, {money:true})}
                ${kv('Tax', ex.tax, {money:true})}
                ${kv('Tip', ex.tip, {money:true})}
                ${kv('Due Date', ex.dueDate)}
              </div>
            </div>` : ''}
          </div>
        </div>
        ${docItems.length ? `
        <div style="margin-top:12px;">
          <strong>Extracted Items (${docItems.length})</strong>
          <div style="overflow:auto;">
            <table style="width:100%;border-collapse:collapse;margin-top:6px;font-size:13px;">
              <thead>
                <tr style="background:#f3f4f6;">
                  <th style="text-align:left;padding:6px;border:1px solid #e5e7eb;">Vendor</th>
                  <th style="text-align:left;padding:6px;border:1px solid #e5e7eb;">Date</th>
                  <th style="text-align:right;padding:6px;border:1px solid #e5e7eb;">Amount</th>
                  <th style="text-align:left;padding:6px;border:1px solid #e5e7eb;">Currency</th>
                </tr>
              </thead>
              <tbody>
                ${docItems.map(it => {
                  const amt = Number.isFinite(Number(it.amount)) ? `$${Number(it.amount).toLocaleString('en-US',{minimumFractionDigits:2})}` : '—';
                  return `<tr>
                    <td style=\\"padding:6px;border:1px solid #e5e7eb;\\">${it.vendor || it.merchant || ''}</td>
                    <td style=\\"padding:6px;border:1px solid #e5e7eb;\\">${it.date || ''}</td>
                    <td style=\\"padding:6px;border:1px solid #e5e7eb;text-align:right;\\">${amt}</td>
                    <td style=\\"padding:6px;border:1px solid #e5e7eb;\\">${it.currency || 'USD'}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>` : ''}
        <div style="margin-top:12px;">
          <strong>OCR Text</strong>
          <div style="white-space:pre-wrap;font-family:ui-monospace, SFMono-Regular, Menlo, monospace;font-size:12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:8px;max-height:180px;overflow:auto;">${ocrSnippet || '<span style="color:#9ca3af;">No OCR text</span>'}</div>
        </div>
        <div style="margin-top:12px;">
          <strong>Linked GL Rows (${glRows.length})</strong>
          <ul style="margin-top:6px;padding-left:18px;">${glList}</ul>
        </div>
        <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end;">
          <a class="btn btn--outline" href="${this.getDocumentUrl(doc)}" target="_blank">Open File</a>
          ${glRows.length ? `<button class=\"btn btn--primary\" onclick=\"window.app.openLinkModal('${glRows[0].id}')\">Manage Links</button>` : ''}
        </div>
      `;
      modal.classList.add('show');
      modal.style.display = '';
    } catch (e) {
      console.error('Failed to open document details:', e);
    }
  }

  async reprocessDocument(docId) {
    const doc = this.docs.documents.find(d => d.id === docId);
    if (!doc) {
      alert('Document not found');
      return;
    }

    {
      const ok = this.confirmAsync ? (await this.confirmAsync(`Reprocess "${doc.filename}" with OCR?`)) : confirm(`Reprocess "${doc.filename}" with OCR?`);
      if (!ok) return;
    }

    const perfStart = Date.now();
    try {
      const response = await fetch(`${this.apiBaseUrl}/api/docs/reprocess`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          document_id: docId,
          force_reprocess: true
        })
      });

      if (response.ok) {
        await this.refreshDocumentTable();
        await this.updateDocumentMetrics();
        if (this.showToast) this.showToast(`Successfully reprocessed "${doc.filename}"`, 'success');
        this.logPerformance('Reprocess Document', perfStart, doc.filename);
      } else {
        const text = await response.text().catch(() => '');
        let detail = `Failed to reprocess document: ${response.status}`;
        try { const j = JSON.parse(text); detail = j?.error || j?.details || detail; } catch(_) { if (text) detail = text; }
        throw new Error(detail);
      }
    } catch (error) {
      console.error('Reprocess error:', error);
      if (this.showToast) this.showToast('Failed to reprocess document: ' + (error.message || error), 'error');
      this.logPerformance('Reprocess Document (failed)', perfStart, doc.filename);
    }
  }

  // Utility functions
  truncateText(text, maxLength) {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  }

  isImageFile(filename) {
    if (!filename) return false;
    const ext = filename.toLowerCase().split('.').pop();
    return ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff'].includes(ext);
  }

  isPdfFile(filename) {
    if (!filename) return false;
    return filename.toLowerCase().endsWith('.pdf');
  }

  getFileExtension(filename) {
    if (!filename) return 'unknown';
    const ext = filename.toLowerCase().split('.').pop();
    return ext ? `.${ext}` : 'no ext';
  }

  getDocumentUrl(doc) {
    if (!doc.file_url) return null;
    return `${this.apiBaseUrl}${doc.file_url}`;
  }

  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
  // Performance logging helper
  logPerformance(operation, startTime, data) {
    try {
      const duration = Date.now() - startTime;
      console.log(`⏱️ ${operation}: ${duration}ms`, data ? `(${data})` : '');
      if (duration > 2000) console.warn(`🐌 Slow operation detected: ${operation} took ${duration}ms`);
    } catch (_) {}
  }
}

// Initialization is triggered by the page loader (index.html)
// Export only; do not auto-initialize here to avoid double init.

// Export for module compatibility
// Export for both ES modules and regular script loading
if (typeof module !== 'undefined' && module.exports) {
  // Node.js environment
  module.exports = { FARComplianceApp };
} else if (typeof window !== 'undefined') {
  // Browser environment - make available globally
  window.FARComplianceApp = FARComplianceApp;
}

// ES module export
export { FARComplianceApp };
