export function generateReport(auditResults, glData) {
  const reportTitleEl = document.getElementById('report-title');
  const contractNumberEl = document.getElementById('contract-number');
  const includeSummaryEl = document.getElementById('include-summary');
  const includeViolationsEl = document.getElementById('include-violations');
  const includeRecommendationsEl = document.getElementById('include-recommendations');
  
  const reportTitle = (reportTitleEl?.value) || 'FAR Compliance Audit Report';
  const contractNumber = contractNumberEl?.value || '';
  const includeSummary = includeSummaryEl?.checked !== false;
  const includeViolations = includeViolationsEl?.checked !== false;
  const includeRecommendations = includeRecommendationsEl?.checked !== false;

  let reportContent = `<h1>${reportTitle}</h1>`;
  if (contractNumber) {
    reportContent += `<p><strong>Contract Number:</strong> ${contractNumber}</p>`;
  }
  reportContent += `<p><strong>Report Date:</strong> ${new Date().toLocaleDateString()}</p>`;

  const dataToAnalyze = (auditResults && auditResults.length > 0) ? auditResults : (glData || []);

  if (includeSummary) {
    const total = dataToAnalyze.length;
    const red = dataToAnalyze.filter(i => i.status === 'RED').length;
    const yellow = dataToAnalyze.filter(i => i.status === 'YELLOW').length;
    const green = dataToAnalyze.filter(i => i.status === 'GREEN').length || (total > 0 ? total : 0);
    reportContent += `
      <h2>Executive Summary</h2>
      <ul>
        <li><strong>Total Items:</strong> ${total}</li>
        <li><strong>Expressly Unallowable:</strong> ${red}</li>
        <li><strong>Requires Review:</strong> ${yellow}</li>
        <li><strong>Compliant:</strong> ${green}</li>
      </ul>
    `;
  }

  if (includeViolations) {
    const violations = dataToAnalyze.filter(item => item.status === 'RED');
    reportContent += `<h2>Detailed Violations</h2>`;
    if (violations.length === 0) {
      reportContent += `<p>No expressly unallowable costs were identified in the current dataset.</p>`;
    } else {
      violations.forEach((item, index) => {
        reportContent += `
          <div class="violation-item">
            <h3>Violation ${index + 1}</h3>
            <p><strong>Account:</strong> ${item.accountNumber || 'N/A'}</p>
            <p><strong>Description:</strong> ${item.description || 'N/A'}</p>
            <p><strong>Amount:</strong> $${(item.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
            <p><strong>Vendor:</strong> ${item.vendor || 'N/A'}</p>
            <p><strong>FAR Issue:</strong> ${item.farIssue || 'N/A'}</p>
          </div>
        `;
      });
    }
  }

  if (includeRecommendations) {
    reportContent += `
      <h2>Recommendations</h2>
      <div class="recommendation">
        <h3>Immediate Actions Required</h3>
        <ul>
          <li>Remove all expressly unallowable costs from contract billing</li>
          <li>Review and strengthen internal controls for expense approval</li>
          <li>Provide FAR training to procurement and accounting staff</li>
          <li>Implement automated FAR compliance checks in the accounting system</li>
        </ul>
      </div>
      <div class="recommendation">
        <h3>Long-term Improvements</h3>
        <ul>
          <li>Establish regular FAR compliance auditing procedures</li>
          <li>Create vendor training programs on allowable costs</li>
          <li>Implement pre-approval workflows for high-risk expense categories</li>
          <li>Develop comprehensive FAR compliance documentation</li>
        </ul>
      </div>
    `;
  }

  const reportContentElement = document.getElementById('report-content');
  const reportPreview = document.getElementById('report-preview');
  if (reportContentElement && reportPreview) {
    reportContentElement.innerHTML = reportContent;
    reportPreview.classList.remove('hidden');
  }
}

export function exportToPDF() {
  const reportContent = document.getElementById('report-content');
  if (!reportContent || reportContent.innerHTML.trim() === '') {
    alert('Please generate a report first.');
    return;
  }

  const printWindow = window.open('', '_blank');
  const reportHTML = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>FAR Compliance Audit Report</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; }
          h1 { color: #1D4252; border-bottom: 2px solid #21808D; padding-bottom: 8px; }
          h2 { color: #333; margin-top: 24px; }
          .violation-item { background: #fee; padding: 12px; border-radius: 4px; margin: 12px 0; border-left: 3px solid #dc2626; }
          .recommendation { background: #f0f9ff; padding: 12px; border-radius: 4px; margin: 12px 0; }
          ul { margin-left: 20px; }
          p { line-height: 1.5; }
        </style>
      </head>
      <body>
        ${reportContent.innerHTML}
      </body>
    </html>
  `;
  printWindow.document.write(reportHTML);
  printWindow.document.close();
  printWindow.print();
}

