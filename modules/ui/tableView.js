export function renderGLTable(data) {
  const tbody = document.getElementById("gl-table-body");
  if (!tbody) return;

  const rows = (data || []).map((item, index) => {
    const statusBadge = item.status
      ? `<span class="status-badge status-badge--${item.status.toLowerCase()}">${item.status}</span>`
      : '<span class="status-badge status-badge--green">PENDING</span>';
    const reason = item.farIssue || (item.status === 'GREEN' ? 'No issues detected' : '');
    return `
      <tr class="gl-row" data-row-id="${index}" ${item.id ? `data-gl-id="${item.id}"` : ''}>
        <td>${statusBadge}</td>
        <td>${item.accountNumber || ''}</td>
        <td>${item.description || ''}</td>
        <td class="amount">$${(item.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
        <td>${item.date || ''}</td>
        <td>${item.category || ''}</td>
        <td>${item.vendor || ''}</td>
        <td class="center">${typeof item.attachmentsCount === 'number' ? item.attachmentsCount : 0} ${(((typeof item.attachmentsCount === 'number') && item.attachmentsCount > 0) || item.hasReceipt) ? '<span title="Receipt linked">📎</span>' : ''} ${item.id ? `<button class="btn quick-link" data-gl-id="${item.id}">Quick Link</button>` : ''}</td>
        <td>${item.approvalState || ''}</td>
        <td class="far-issue">${reason || 'Not audited'}</td>
      </tr>
      <tr class="gl-row-details hidden" data-row-id="${index}" ${item.id ? `data-gl-id="${item.id}"` : ''}>
        <td colspan="10">
          <div class="gl-details">
            <div class="gl-details__section"><strong>Reason:</strong> ${reason || 'Not audited'} ${item.farSection ? `<span class="gl-details__muted">(FAR ${item.farSection})</span>` : ''}</div>
            <div class="gl-details__grid">
              <div><strong>Account:</strong> ${item.accountNumber || ''}</div>
              <div><strong>Amount:</strong> $${(item.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
              <div><strong>Date:</strong> ${item.date || ''}</div>
              <div><strong>Category:</strong> ${item.category || ''}</div>
              <div><strong>Vendor:</strong> ${item.vendor || ''}</div>
              <div><strong>Contract #:</strong> ${item.contractNumber || ''}</div>
              <div><strong>Status:</strong> ${item.status || 'PENDING'}</div>
              <div><strong>Attachments:</strong> ${typeof item.attachmentsCount === 'number' ? item.attachmentsCount : 0}</div>
              <div><strong>Approvals:</strong> ${typeof item.approvalsCount === 'number' ? item.approvalsCount : (item.hasApproval ? 1 : 0)}</div>
              <div><strong>Approval State:</strong> ${item.approvalState || ''}</div>
            </div>
            <div class="gl-details__section">
              <strong>Linked Documents</strong>
              <div class="gl-linked" ${item.id ? `data-gl-id="${item.id}"` : ''}></div>
            </div>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  tbody.innerHTML = rows;

  // Bind row toggle once via delegation
  if (!tbody.dataset.toggleBound) {
    tbody.addEventListener('click', (e) => {
      const tr = e.target.closest('tr.gl-row');
      if (!tr || !tbody.contains(tr)) return;
      const rowId = tr.getAttribute('data-row-id');
      const details = tbody.querySelector(`tr.gl-row-details[data-row-id="${rowId}"]`);
      if (details) details.classList.toggle('hidden');
    });
    tbody.dataset.toggleBound = 'true';
  }
}

export function filterData(auditResults, severityValue, searchTerm) {
  const sev = severityValue || "";
  const term = (searchTerm || "").toLowerCase();
  return (auditResults || []).filter((item) => {
    const matchesSeverity = !sev || item.status === sev;
    const matchesSearch =
      !term ||
      (item.description && item.description.toLowerCase().includes(term)) ||
      (item.vendor && item.vendor.toLowerCase().includes(term)) ||
      (item.category && item.category.toLowerCase().includes(term));
    return matchesSeverity && matchesSearch;
  });
}
