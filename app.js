// FAR Compliance Audit System - Complete App.js with Document Linking Modal
// Orchestrator (ES Modules)

import { auditAll } from "./modules/services/auditService.js";
import { readExcelFile, mapExcelRows, readExcelAsAOA, mapRowsFromAOA, detectHeaderRow } from "./modules/services/excelService.js";
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
      availableDocuments: [],
      linkedDocumentIds: [],
      selectedDocumentIds: new Set(),
      previewCache: new Map()
    };
  }

  async init() {
    await this.loadConfig();
    this.setupEventListeners();
    this.setupFileUpload();
    this.setupDocsUI();
    this.setupAdminUI();

    // Initialize document modal
    this.setupDocumentModal();

    try {
      // Load existing GL data from server if available
      await this.loadExistingGLData();
      await this.refreshDocsSummary();
      await this.refreshRequirementsSummary();
      this.renderGLTable();
      this.updateDashboard();
      await this.renderUnmatchedList();
    } catch (_) {}

    this.renderGLTable();
    this.updateDashboard();

    try { await this.updateDocsControlsEnabled(); } catch (_) {}
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

      if (!this.apiBaseUrl) this.apiBaseUrl = window.location.origin;

    } catch (e) {
      console.warn('Failed to load config. Using defaults.', e);
    }
  }

  async loadExistingGLData() {
    try {
      if (this.apiBaseUrl) {
        console.log('Loading existing GL data from server...');
        const result = await fetchGLEntries(this.apiBaseUrl, 1000, 0);
        if (result && Array.isArray(result.rows) && result.rows.length > 0) {
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
            docFlagUnallowable: row.doc_flag_unallowable
          }));
          console.log(`Loaded ${this.glData.length} existing GL entries from server`);
          
          // Run initial audit if FAR rules are loaded
          if (this.farRules && this.farRules.length > 0) {
            this.runInitialAudit();
          }
        }
      }
    } catch (e) {
      console.warn('Failed to load existing GL data:', e);
    }
  }

  runInitialAudit() {
    if (this.glData && this.glData.length > 0 && this.farRules && this.farRules.length > 0) {
      this.auditResults = auditAll(this.glData, this.farRules, this.config);
      console.log("Initial audit completed with", this.auditResults.length, "results");
    }
  }

  setupEventListeners() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Use the button that owns the handler, not the inner clicked node
        const ownerBtn = e.currentTarget || e.target.closest('.tab-btn');
        const tabName = ownerBtn ? ownerBtn.getAttribute("data-tab") : null;
        if (tabName) this.switchTab(tabName);
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

    const processGLBtn = document.getElementById("process-gl-btn");

    if (processGLBtn) {
      processGLBtn.addEventListener("click", (e) => {
        e.preventDefault();
        if (this.uploadedFile) {
          this.processUploadedFile();
        } else if (this.glData && this.glData.length > 0) {
          this.runAudit();
          this.switchTab("review");
        } else {
          alert("Please select an Excel file first or ensure GL data is loaded.");
        }
      });
    }

    const pendingOnlyEl = document.getElementById('pending-only');
    if (pendingOnlyEl && !pendingOnlyEl.dataset.bound) {
      pendingOnlyEl.addEventListener('change', () => this.filterTable());
      pendingOnlyEl.dataset.bound = 'true';
    }

    const severityFilter = document.getElementById("severity-filter");
    const searchInput = document.getElementById("search-input");

    if (severityFilter) {
      severityFilter.addEventListener("change", () => this.filterTable());
    }

    if (searchInput) {
      if (!this._debouncedFilter) {
        this._debouncedFilter = this.debounce(() => this.filterTable(), 200);
      }
      // Use debounced input to avoid excessive re-rendering while typing
      searchInput.addEventListener("input", this._debouncedFilter);
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

    const glTable = document.getElementById("gl-table");
    if (glTable) {
      glTable.addEventListener("click", (e) => {
        // Find the button that was clicked, if any
        const linkButton = e.target.closest(".quick-link");
        if (linkButton && linkButton.dataset.glId) {
          e.preventDefault();
          this.openLinkModal(linkButton.dataset.glId);
        }
      });
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
      if (!this.apiBaseUrl) {
        if (statusEl) statusEl.textContent = 'Server not available. Ensure backend is running.';
        return;
      }

      const list = Array.from(files);
      if (!list.length) {
        if (statusEl) statusEl.textContent = 'No files selected.';
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
    const searchInput = document.getElementById('doc-search-input');
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
    await this.loadDocumentsAndLinks();
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

    const details = [
      { label: 'Account', value: glItem.accountNumber || 'N/A' },
      { label: 'Description', value: glItem.description || 'N/A' },
      { label: 'Amount', value: glItem.amount ? `$${parseFloat(glItem.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : 'N/A' },
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
    try {
      const docsData = await listDocItems(this.apiBaseUrl);
      this.documentModal.availableDocuments = docsData.documents || [];
      
      this.documentModal.linkedDocumentIds = this.documentModal.currentGLItem.linked_documents || [];
      this.documentModal.selectedDocumentIds = new Set(this.documentModal.linkedDocumentIds);
      
      console.log('Loaded documents:', this.documentModal.availableDocuments.length);
      console.log('Currently linked:', this.documentModal.linkedDocumentIds);
      
    } catch (error) {
      console.error('Error loading documents:', error);
      this.documentModal.availableDocuments = [];
      this.documentModal.linkedDocumentIds = [];
    }
  }

  renderModalDocuments() {
    const container = document.getElementById('available-documents');
    if (!container) return;

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
              ${doc.uploadDate ? `- ${new Date(doc.uploadDate).toLocaleDateString()}` : ''}
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
    const searchTerm = document.getElementById('doc-search-input')?.value.toLowerCase() || '';
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

  async saveLinkChanges() {
    if (!this.documentModal.currentGLItem) return;

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
      } else {
        alert('No changes were made.');
      }
      
      this.closeLinkModal();
      
    } catch (error) {
      console.error('Error saving link changes:', error);
      alert('Error saving changes: ' + (error.message || error));
    }
  }

  async refreshModalDocuments() {
    await this.loadDocumentsAndLinks();
    this.renderModalDocuments();
  }

  // END DOCUMENT MODAL METHODS

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
    } catch (_) {}
  }

  async refreshRequirementsSummary() {
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
      
      return r;
    } catch (_) {
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
    if (!name.match(/\.(xlsx|xls)$/i)) {
      alert('Please upload an Excel file (.xlsx or .xls)');
      return;
    }

    const fileInfo = document.getElementById("file-info");
    const fileDetails = document.getElementById("file-details");

    if (fileInfo && fileDetails) {
      fileDetails.innerHTML = `
        <p><strong>File:</strong> ${file.name}</p>
        <p><strong>Size:</strong> ${(file.size / 1024).toFixed(2)} KB</p>
        <p><strong>Type:</strong> ${file.type}</p>
      `;
      fileInfo.classList.remove("hidden");
    } else if (fileInfo) {
      fileInfo.innerHTML = `
        <h4>File Information</h4>
        <p><strong>File:</strong> ${file.name}</p>
        <p><strong>Size:</strong> ${(file.size / 1024).toFixed(2)} KB</p>
        <p><strong>Type:</strong> ${file.type}</p>
      `;
      fileInfo.classList.remove("hidden");
    }

    this.uploadedFile = file;
  }

  async processUploadedFile() {
    if (!this.uploadedFile) {
      alert("Please select a file first.");
      return;
    }

    try {
      if (typeof XLSX === 'undefined') {
        alert('Excel parser (XLSX) not loaded. Please ensure you are online and the page can access cdnjs.');
        return;
      }

      const jsonData = await readExcelFile(this.uploadedFile);
      this.glData = mapExcelRows(jsonData);

      const weak = this.isWeakMapping(this.glData);
      if (weak) {
        const aoa = await readExcelAsAOA(this.uploadedFile);
        const ok = await this.attemptAutoMappingFromAOA(aoa).catch(() => false);
        if (!ok) {
          this.prepareMappingUI(aoa);
          return;
        }
      }

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
      
      alert(`Successfully processed ${this.glData.length} GL entries.`);
    } catch (error) {
      alert("Error processing Excel file: " + error.message);
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

  prepareMappingUI(aoa) {
    // Implementation would be here - omitted for brevity
    alert('Manual mapping UI would be shown here');
  }

  runAudit() {
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

      console.log("Running auditAll with:", {
        glDataCount: this.glData.length,
        farRulesCount: this.farRules.length,
        config: this.config,
        sampleGLItem: this.glData[0]
      });

      this.auditResults = auditAll(this.glData, this.farRules, this.config);
      
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

      this.switchTab("review");

    } catch (error) {
      console.error("Audit error:", error);
      
      const processingIndicator = document.getElementById("processing-indicator");
      if (processingIndicator) {
        processingIndicator.classList.add("hidden");
      }
      
      alert("Error running audit: " + error.message);
    }
  }

  async runLLMReview() {
    if (!this.apiBaseUrl) {
      alert('LLM review requires server API configuration.');
      return;
    }

    if (!this.glData || this.glData.length === 0) {
      alert('No GL data to review. Please upload data first.');
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
      } else {
        alert('LLM review completed but no enhancements were made.');
      }

      if (btn) btn.textContent = orig;
    } catch (err) {
      alert('AI review failed: ' + (err.message || err));
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
      const dataForDashboard = this.auditResults && this.auditResults.length > 0 
        ? this.auditResults 
        : this.glData;
      
      updateDashboardUI(dataForDashboard, this.auditResults, this.charts);
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
      this.updateDashboard();
    } else if (tabName === "logs") {
      this.initializeLogsTab();
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
    try {
      const reportOptions = {
        auditResults: this.auditResults,
        glData: this.glData,
        reportTitle: 'FAR Compliance Audit Report',
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
    } catch (error) {
      alert("Error generating report: " + error.message);
      console.error("Report generation error:", error);
    }
  }

  exportToPDF() {
    try {
      exportPDF(this.glData, this.auditResults, this.farRules);
    } catch (error) {
      alert("Error exporting to PDF: " + error.message);
      console.error("PDF export error:", error);
    }
  }

  async renderUnmatchedList() {
    // Implementation omitted for brevity
  }

  async linkDocument(glId, docId) {
    if (!glId || !docId) {
      throw new Error('GL ID and Document ID are required');
    }

    try {
      if (!this.apiBaseUrl) {
        throw new Error('API not configured for document linking');
      }

      await linkDocItem(this.apiBaseUrl, glId, docId);
      
      const glItem = this.glData.find(g => String(g.id) === String(glId));
      if (glItem) {
        glItem.linked_documents = glItem.linked_documents || [];
        if (!glItem.linked_documents.includes(docId)) {
          glItem.linked_documents.push(docId);
        }
      }

    } catch (err) {
      throw new Error('Failed to link document: ' + (err.message || err));
    }
  }

  async unlinkDocument(glId, docId) {
    try {
      if (!this.apiBaseUrl) {
        throw new Error('API not configured for document unlinking');
      }

      await unlinkDocItem(this.apiBaseUrl, glId, docId);
      
      const glItem = this.glData.find(g => String(g.id) === String(glId));
      if (glItem && glItem.linked_documents) {
        glItem.linked_documents = glItem.linked_documents.filter(id => id !== docId);
      }

    } catch (err) {
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
}

// Initialize app when DOM is ready
document.addEventListener("DOMContentLoaded", async () => {
  window.app = new FARComplianceApp();
  await window.app.init();
});

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
