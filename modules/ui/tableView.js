// Safe, minimal table renderer
export function renderGLTable(data) {
  console.log('📊 Rendering GL table with', data?.length || 0, 'items');
  const tbody = document.getElementById("gl-table-body");
  if (!tbody) {
    console.error('❌ GL table body element not found');
    return;
  }

  if (!Array.isArray(data) || data.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" style="text-align: center; padding: 40px; color: #6b7280;">
          <div style="margin-bottom: 8px;">📄 No GL data available</div>
          <div style="font-size: 14px;">Upload an Excel file to get started</div>
        </td>
      </tr>
    `;
    return;
  }

  function parseClientAmount(val) {
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
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr; // Return original if invalid
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      const year = date.getFullYear();
      return `${month}/${day}/${year}`;
    } catch (e) {
      return dateStr; // Return original if parsing fails
    }
  }

  const rows = data.map((item, index) => {
    const safeItem = {
      id: item.id || index,
      status: item.status || 'PENDING',
      accountNumber: String(item.accountNumber || ''),
      description: String(item.description || ''),
      amount: parseClientAmount(item.amount),
      date: String(item.date || ''),
      category: String(item.category || ''),
      vendor: String(item.vendor || ''),
      farIssue: String(item.farIssue || 'Not audited'),
      linked_documents: Array.isArray(item.linked_documents) ? item.linked_documents : []
    };
    const statusClass = safeItem.status.toLowerCase();
    // Derive actual linked count when available
    let linkedCount = safeItem.linked_documents.length;
    try {
      if (typeof window !== 'undefined' && window.app && window.app.docs) {
        const links = (window.app.docs.links || []).filter(l => String(l.gl_entry_id) === String(safeItem.id));
        linkedCount = links.length;
      } else if (Number.isFinite(item.attachmentsCount)) {
        linkedCount = Number(item.attachmentsCount) || 0;
      }
    } catch (_) {}
    const escape = (str) => { const div = document.createElement('div'); div.textContent = str; return div.innerHTML; };
    const approvalsCount = Number(item.approvalsCount || 0);
    const hasApproval = approvalsCount > 0;
    return `
      <tr class="gl-row" data-row-id="${index}" data-gl-id="${safeItem.id}">
        <td><span class="status-badge status-badge--${statusClass}">${escape(safeItem.status)}</span></td>
        <td>${escape(safeItem.accountNumber)}</td>
        <td title="${escape(safeItem.description)}">${escape(safeItem.description.substring(0, 50))}${safeItem.description.length > 50 ? '...' : ''}</td>
        <td class="amount">$${safeItem.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
        <td>${escape(formatDate(safeItem.date))}</td>
        <td>${escape(safeItem.category)}</td>
        <td>${escape(safeItem.vendor)}</td>
        <td class="center"><span class="attachment-count" title="${linkedCount} document(s) linked">${linkedCount}</span></td>
        <td><button class="quick-link" data-gl-id="${safeItem.id}" title="Link Documents">Link</button></td>
        <td><span class="approval-status ${hasApproval ? 'approved' : 'pending'}" title="${approvalsCount} approval(s)">${hasApproval ? 'Approved' : 'Pending'}</span></td>
        <td class="far-issue" title="${escape(safeItem.farIssue)}">${escape(safeItem.farIssue.substring(0, 30))}${safeItem.farIssue.length > 30 ? '...' : ''}</td>
      </tr>
    `;
  }).join('');
  tbody.innerHTML = rows;
  console.log(`✅ Table rendered with ${data.length} rows`);

  // Store data for sorting functionality
  if (typeof window !== 'undefined' && window.currentGLData !== undefined) {
    window.currentGLData = data;
  }

  // Bind row expand/collapse to show linked docs details
  try {
    tbody.querySelectorAll('tr.gl-row').forEach((tr) => {
      tr.addEventListener('click', (ev) => {
        if (ev.target.closest('button')) return; // ignore button clicks
        const existing = tr.nextElementSibling;
        if (existing && existing.classList.contains('gl-row-details')) {
          existing.remove();
          tr.classList.remove('active');
          return;
        }
        const glId = tr.getAttribute('data-gl-id');
        const detailsTr = document.createElement('tr');
        detailsTr.className = 'gl-row-details';
        const td = document.createElement('td');
        td.colSpan = tr.children.length;
        td.innerHTML = buildDetailsContent(glId);
        detailsTr.appendChild(td);
        tr.insertAdjacentElement('afterend', detailsTr);
        tr.classList.add('active');
      });
    });

    tbody.querySelectorAll('button.quick-link').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const glId = btn.getAttribute('data-gl-id');
        if (window.app && typeof window.app.openLinkModal === 'function') {
          window.app.openLinkModal(glId);
        }
      });
    });
  } catch (e) {
    console.error('Failed to bind GL row interactions:', e);
  }
}

export function filterData(auditResults, severityValue, searchTerm) {
  const sev = severityValue;
  const term = searchTerm.toLowerCase();

  return auditResults.filter((item) => {
    const matchesSeverity = !sev || item.status === sev;
    const matchesSearch = !term || (
      (item.description && item.description.toLowerCase().includes(term)) ||
      (item.vendor && item.vendor.toLowerCase().includes(term)) ||
      (item.category && item.category.toLowerCase().includes(term))
    );
    
    return matchesSeverity && matchesSearch;
  });
}

// Add these styles if not already present in your CSS
const additionalCSS = `
.quick-link {
  background: #3b82f6;
  color: white;
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.quick-link:hover {
  background: #2563eb;
}

.attachment-count {
  display: inline-block;
  background: #f3f4f6;
  color: #374151;
  padding: 2px 6px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
  margin-right: 4px;
  min-width: 16px;
  text-align: center;
}

.attachment-count[title*="linked"] {
  background: #dcfce7;
  color: #166534;
}

.linked-doc {
  display: inline-block;
  background: #dcfce7;
  color: #166534;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  margin-right: 4px;
  margin-bottom: 2px;
}

.no-links {
  color: #9ca3af;
  font-style: italic;
  font-size: 12px;
}

.gl-details-section {
  margin-bottom: 16px;
}

.gl-details-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px;
  margin-top: 8px;
}

.gl-details-muted {
  color: #6b7280;
  font-weight: normal;
  font-size: 12px;
}

.gl-row {
  cursor: pointer;
}

.gl-row:hover {
  background-color: #f9fafb;
}

.gl-row.active {
  background-color: #eef2ff;
  border-left: 4px solid #3b82f6;
}

.gl-row-details {
  background-color: #f8fafc;
}

.gl-row-details.hidden {
  display: none;
}

.gl-details {
  padding: 16px;
  border-top: 1px solid #e5e7eb;
}

.center {
  text-align: center;
}

.gl-linked-docs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.gl-linked-doc { background: #eef2ff; border: 1px solid #c7d2fe; color: #1e40af; padding: 4px 8px; border-radius: 12px; font-size: 12px; }

/* Thumbnails gallery for compact GL row details */
.gl-linked-gallery { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
.gl-thumb { position:relative; width:64px; min-width:64px; height:64px; border:1px solid #e5e7eb; border-radius:6px; overflow:hidden; background:#f3f4f6; display:flex; align-items:center; justify-content:center; text-decoration:none; }
body.compact .gl-thumb { width:56px; min-width:56px; height:56px; }
.gl-thumb-img { width:100%; height:100%; object-fit:cover; display:block; }
.gl-thumb-fallback { font-size:12px; font-weight:600; color:#374151; }
.gl-thumb-caption { display:none; }
.gl-thumb-badge { position:absolute; bottom:2px; right:2px; font-size:10px; line-height:1; background:rgba(17,24,39,0.7); color:#fff; padding:1px 4px; border-radius:3px; text-transform:uppercase; }
`;

// Inject the additional CSS if not already present
if (!document.getElementById('table-view-styles')) {
  const styleElement = document.createElement('style');
  styleElement.id = 'table-view-styles';
  styleElement.innerHTML = additionalCSS;
  document.head.appendChild(styleElement);
}

function buildDetailsContent(glId) {
  try {
    const links = (window.app?.docs?.links || []).filter(l => String(l.gl_entry_id) === String(glId));
    const items = window.app?.docs?.items || [];
    const docs = window.app?.docs?.documents || [];
    const linked = links.map(l => {
      const it = items.find(i => String(i.id) === String(l.document_item_id));
      const doc = it ? docs.find(d => String(d.id) === String(it.document_id)) : null;
      return { it, doc, link: l };
    }).filter(x => x.doc);

    const base = (window.app?.apiBaseUrl || '').replace(/\/$/, '');
    const gallery = linked.length
      ? `<div class="gl-linked-gallery">${linked.map(({ doc }) => {
            const name = String(doc.filename || '').replace(/</g, '&lt;');
            const href = doc.file_url ? `${base}${doc.file_url}` : '#';
            const isImage = (doc.mimetype && doc.mimetype.startsWith('image/')) || /\.(png|jpe?g|gif|bmp|webp|tiff?)$/i.test(doc.filename || '');
            const isPdf = /\.pdf$/i.test(doc.filename || '');
            const thumb = isImage && href && href !== '#'
              ? `<img class=\"gl-thumb-img\" src=\"${href}\" alt=\"${name}\" onerror=\"this.style.display='none'\">`
              : `<div class=\"gl-thumb-fallback\">${isPdf ? 'PDF' : 'DOC'}</div>`;
            const badge = (doc.doctype || 'other');
            return `<a class=\"gl-thumb\" href=\"${href}\" target=\"_blank\" title=\"${name}\">${thumb}<span class=\"gl-thumb-badge ${badge}\">${badge}</span></a>`;
        }).join('')}</div>`
      : `<div class="gl-details-muted">No documents linked. Use the Link button to attach.</div>`;

    let ocrBlock = '';
    if (linked.length) {
      // Build a rich block per linked item with all OCR fields we have
      const perItem = linked.map(({ it, doc, link }) => {
        const amt = Number(it?.amount);
        const dt = it?.date || '';
        const ven = it?.vendor || it?.merchant || '';
        const method = it?.details?.processing_method || (doc?.meta?.processing_method) || '';
        const score = (link && (link.score || link.match_score)) ? Math.round((link.score || link.match_score) * 100) + '%' : (doc?.document_match_score ? Math.round(doc.document_match_score) + '%' : '');

        // Attempt to parse extended extracted data from doc.text_content
        let ex = null;
        try {
          if ((doc?.text_content || '').startsWith('OCR extracted data: ')) {
            ex = JSON.parse(doc.text_content.replace('OCR extracted data: ', ''));
          }
        } catch(_) {}
        const fmtVal = (value, opts={}) => {
          if (value === null || value === undefined || value === '') return '—';
          if (opts.money && Number.isFinite(Number(value))) return `$${Number(value).toLocaleString('en-US',{minimumFractionDigits:2})}`;
          if (Array.isArray(value)) return value.map(x => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ');
          if (typeof value === 'object') { try { return JSON.stringify(value); } catch { return String(value); } }
          return String(value);
        };
        const kv = (label, value, opts={}) => `<div><strong>${label}</strong><div>${fmtVal(value, opts)}</div></div>`;

        // Primary info row (renamed and reordered)
        const idLabel = 'Invoice ID / Receipt ID';
        const invOrReceipt = ex?.invoiceId ?? ex?.receiptId ?? null;
        const primary = `
          <div class="gl-details-grid" style="margin-top:8px;">
            ${kv('Transaction Date', dt || '—')}
            ${kv('Merchant', ven || '—')}
            ${kv(idLabel, invOrReceipt || '—')}
            ${kv('Method', method || '—')}
            ${score ? kv('Match Score', score) : ''}
          </div>`;

        // Secondary details (Total Amount moved to bottom; Due Date removed)
        const secondary = ex ? `
          <div class="gl-details-grid" style="margin-top:8px;grid-template-columns:repeat(3,minmax(0,1fr));">
            ${kv('Description', ex.description)}
            ${kv('Summary', ex.summary)}
            ${kv('Customer Name', ex.customerName)}
            ${kv('Billing Address', ex.billingAddress)}
            ${kv('Merchant Address', ex.merchantAddress)}
            ${kv('Merchant Phone', ex.merchantPhone)}
            ${kv('Receipt Type', ex.receiptType)}
            ${kv('Transaction Time', ex.transactionTime)}
            ${kv('Subtotal', ex.subtotal ?? ex.subTotal, {money:true})}
            ${kv('Tax', ex.tax, {money:true})}
            ${kv('Tip', ex.tip, {money:true})}
            ${kv('Total Amount', Number.isFinite(Number(amt)) ? amt : (ex.amount ?? null), {money:true})}
          </div>` : '';

        // Approvals list per document (if available)
        let approvals = '';
        if (Array.isArray(doc?.approvals) && doc.approvals.length) {
          const rows = doc.approvals.map(a => {
            const dec = (a.decision || 'unknown').toString().toUpperCase();
            const who = a.approver || 'Unknown';
            const title = a.title ? ` (${a.title})` : '';
            const when = a.date ? ` on ${a.date}` : '';
            return `<div>- ${dec}: ${who}${title}${when}</div>`;
          }).join('');
          approvals = `<div style="margin-top:8px;"><strong>Approvals</strong><div>${rows}</div></div>`;
        }

        return primary + secondary + approvals;
      }).join('');
      ocrBlock = perItem;
    }

    const manage = `<div style=\"margin-top:8px;\"><button class=\"quick-link\" data-gl-id=\"${glId}\" onclick=\"window.app && window.app.openLinkModal && window.app.openLinkModal('${glId}')\">Manage Links</button></div>`;
    return `<div class="gl-details"><div class="gl-details-section"><strong>Linked Documents:</strong> <span class="gl-details-muted">${linked.length} item(s)</span>${gallery}${ocrBlock}${manage}</div></div>`;
  } catch (_) {
    return `<div class="gl-details">Failed to load details</div>`;
  }
}
