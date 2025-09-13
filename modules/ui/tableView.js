// Complete tableView.js with Document Linking Modal Integration

export function renderGLTable(data) {
  const tbody = document.getElementById("gl-table-body");
  if (!tbody) return;

  const rows = data.map((item, index) => {
    const statusBadge = item.status
      ? `<span class="status-badge status-badge--${item.status.toLowerCase()}">${item.status}</span>`
      : `<span class="status-badge status-badge--green">PENDING</span>`;

    const reason = item.farIssue || (item.status !== "GREEN" ? "No issues detected" : "Not audited");
    
    // Count linked documents
    const linkedCount = item.linked_documents ? item.linked_documents.length : 0;
    const attachmentDisplay = linkedCount > 0 ? 
      `<span class="attachment-count" title="${linkedCount} document(s) linked">${linkedCount}</span>` : 
      `<span class="attachment-count">0</span>`;

    return `
      <tr class="gl-row" data-row-id="${index}" ${item.id ? `data-gl-id="${item.id}"` : ''}>
        <td>${statusBadge}</td>
        <td>${item.accountNumber || ''}</td>
        <td>${item.description || ''}</td>
        <td class="amount">$${(item.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
        <td>${item.date || ''}</td>
        <td>${item.category || ''}</td>
        <td>${item.vendor || ''}</td>
        <td class="center">
          ${attachmentDisplay}
          ${item.hasReceipt ? '<span title="Receipt linked">📄</span>' : ''}
        </td>
        <td>
          ${item.id ? `<button class="quick-link" data-gl-id="${item.id}" title="Link Documents">Quick Link</button>` : ''}
        </td>
        <td>${item.approvalState || ''}</td>
        <td class="far-issue">${reason || 'Not audited'}</td>
      </tr>
      <tr class="gl-row-details hidden" data-row-id="${index}" ${item.id ? `data-gl-id="${item.id}"` : ''}>
        <td colspan="11">
          <div class="gl-details">
            <div class="gl-details-section">
              <strong>Reason:</strong> ${reason || 'Not audited'}
              ${item.farSection ? `<span class="gl-details-muted">(FAR ${item.farSection})</span>` : ''}
            </div>
            
            <div class="gl-details-grid">
              <div><strong>Account:</strong> ${item.accountNumber || ''}</div>
              <div><strong>Amount:</strong> $${(item.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
              <div><strong>Date:</strong> ${item.date || ''}</div>
              <div><strong>Category:</strong> ${item.category || ''}</div>
              <div><strong>Vendor:</strong> ${item.vendor || ''}</div>
              <div><strong>Contract #:</strong> ${item.contractNumber || ''}</div>
              <div><strong>Status:</strong> ${item.status || 'PENDING'}</div>
              <div><strong>Attachments:</strong> ${linkedCount}</div>
              <div><strong>Approvals:</strong> ${typeof item.approvalsCount === 'number' ? item.approvalsCount : (item.hasApproval ? 1 : 0)}</div>
              <div><strong>Approval State:</strong> ${item.approvalState || ''}</div>
            </div>
            
            <div class="gl-details-section">
              <strong>Linked Documents:</strong>
              <div class="gl-linked" ${item.id ? `data-gl-id="${item.id}"` : ''}>
                ${renderLinkedDocuments(item)}
              </div>
            </div>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.innerHTML = rows;

  // Bind row toggle once via delegation
  if (!tbody.dataset.toggleBound) {
    tbody.addEventListener('click', (e) => {
      const tr = e.target.closest('tr.gl-row');
      if (!tr || !tbody.contains(tr)) return;

      const rowId = tr.getAttribute('data-row-id');
      const details = tbody.querySelector(`tr.gl-row-details[data-row-id="${rowId}"]`);
      if (details) {
        details.classList.toggle('hidden');
      }
    });
    tbody.dataset.toggleBound = 'true';
  }
}

function renderLinkedDocuments(item) {
  if (!item.linked_documents || !item.linked_documents.length) {
    return '<span class="no-links">No documents linked</span>';
  }

  // This would need access to the documents list to show names
  // For now, just show count and IDs
  return item.linked_documents.map(docId => 
    `<span class="linked-doc" title="Document ID: ${docId}">📄 Doc-${docId.substring(0, 8)}</span>`
  ).join(' ');
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