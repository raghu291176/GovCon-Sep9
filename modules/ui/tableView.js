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

  const rows = data.map((item, index) => {
    const safeItem = {
      id: item.id || index,
      status: item.status || 'PENDING',
      accountNumber: String(item.accountNumber || ''),
      description: String(item.description || ''),
      amount: Number(item.amount) || 0,
      date: String(item.date || ''),
      category: String(item.category || ''),
      vendor: String(item.vendor || ''),
      farIssue: String(item.farIssue || 'Not audited'),
      linked_documents: Array.isArray(item.linked_documents) ? item.linked_documents : []
    };
    const statusClass = safeItem.status.toLowerCase();
    const linkedCount = safeItem.linked_documents.length;
    const escape = (str) => { const div = document.createElement('div'); div.textContent = str; return div.innerHTML; };
    return `
      <tr class="gl-row" data-row-id="${index}" data-gl-id="${safeItem.id}">
        <td><span class="status-badge status-badge--${statusClass}">${escape(safeItem.status)}</span></td>
        <td>${escape(safeItem.accountNumber)}</td>
        <td title="${escape(safeItem.description)}">${escape(safeItem.description.substring(0, 50))}${safeItem.description.length > 50 ? '...' : ''}</td>
        <td class="amount">$${safeItem.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
        <td>${escape(safeItem.date)}</td>
        <td>${escape(safeItem.category)}</td>
        <td>${escape(safeItem.vendor)}</td>
        <td class="center"><span class="attachment-count" title="${linkedCount} document(s) linked">${linkedCount}</span></td>
        <td><button class="quick-link" data-gl-id="${safeItem.id}" title="Link Documents">Link</button></td>
        <td></td>
        <td class="far-issue" title="${escape(safeItem.farIssue)}">${escape(safeItem.farIssue.substring(0, 30))}${safeItem.farIssue.length > 30 ? '...' : ''}</td>
      </tr>
    `;
  }).join('');
  tbody.innerHTML = rows;
  console.log(`✅ Table rendered with ${data.length} rows`);
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
`;

// Inject the additional CSS if not already present
if (!document.getElementById('table-view-styles')) {
  const styleElement = document.createElement('style');
  styleElement.id = 'table-view-styles';
  styleElement.innerHTML = additionalCSS;
  document.head.appendChild(styleElement);
}
