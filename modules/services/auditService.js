export function auditItem(item, farRules, options = {}) {
  const description = (item.description || "").toLowerCase();
  let status = "GREEN";
  let farIssue = "Compliant";
  let farSection = "";

  for (const rule of farRules) {
    for (const keyword of rule.keywords) {
      if (description.includes(keyword.toLowerCase())) {
        if (rule.severity === "EXPRESSLY_UNALLOWABLE") {
          status = "RED";
        } else if (rule.severity === "LIMITED_ALLOWABLE") {
          status = "YELLOW";
        }
        farIssue = `${rule.title} (${rule.section})`;
        farSection = rule.section;
        break;
      }
    }
    if (status !== "GREEN") break;
  }

  // Removed amount-based threshold classification. GL review is rule-driven only.

  return { status, farIssue, farSection };
}

export function auditAll(glData, farRules, options = {}) {
  return (glData || []).map((item) => ({ ...item, ...auditItem(item, farRules, options) }));
}

/**
 * Enhanced audit function that checks for approvals in attached documents
 * and re-evaluates status using GPT-4o when approval keywords are found
 */
export async function auditWithApprovalDetection(glData, farRules, docsData, options = {}) {
  if (!Array.isArray(glData)) return [];

  const results = [];

  for (const glItem of glData) {
    // First, run the standard audit
    let auditResult = { ...glItem, ...auditItem(glItem, farRules, options) };

    // Find all documents linked to this GL item
    const linkedDocs = findLinkedDocuments(glItem.id, docsData);

    if (linkedDocs.length > 0) {
      // Check if any document contains approval keywords
      const hasApprovalKeywords = linkedDocs.some(doc => containsApprovalKeywords(doc));

      if (hasApprovalKeywords) {
        console.log(`GL item ${glItem.id} has approval keywords in attached documents - requesting GPT-4o re-evaluation`);

        // Re-evaluate using GPT-4o with all context
        try {
          const gptReEvaluation = await reEvaluateWithGPT4o(glItem, linkedDocs, auditResult, farRules, options);
          if (gptReEvaluation.success) {
            auditResult = { ...auditResult, ...gptReEvaluation.updatedAudit };
            auditResult.approvalBasedReEvaluation = true;
            auditResult.reEvaluationReason = 'Approval keywords detected in attached documents';
          }
        } catch (error) {
          console.warn(`GPT-4o re-evaluation failed for GL item ${glItem.id}:`, error.message);
          auditResult.reEvaluationError = error.message;
        }
      }
    }

    results.push(auditResult);
  }

  return results;
}

/**
 * Find all documents linked to a specific GL item
 */
function findLinkedDocuments(glId, docsData) {
  if (!docsData || !docsData.links || !docsData.documents || !docsData.items) {
    return [];
  }

  const linkedDocuments = [];

  // Find links for this GL item
  const links = docsData.links.filter(link => String(link.gl_entry_id) === String(glId));

  for (const link of links) {
    // Find the document item
    const docItem = docsData.items.find(item => String(item.id) === String(link.document_item_id));
    if (docItem) {
      // Find the actual document
      const document = docsData.documents.find(doc => String(doc.id) === String(docItem.document_id));
      if (document) {
        linkedDocuments.push({
          document,
          docItem,
          link
        });
      }
    }
  }

  return linkedDocuments;
}

/**
 * Check if a document contains approval keywords
 */
function containsApprovalKeywords(docData) {
  const { document, docItem } = docData;

  // Keywords to search for (including synonyms)
  const approvalKeywords = [
    'approved', 'approval', 'approve', 'approving',
    'authorized', 'authorised', 'authorization', 'authorisation',
    'sign off', 'sign-off', 'signoff',
    'ok to pay', 'payment approved', 'authorized for payment',
    'reviewed and approved', 'approved for payment',
    'sanctioned', 'validated', 'confirmed approval'
  ];

  // Check document filename
  const filename = (document.filename || '').toLowerCase();
  if (approvalKeywords.some(keyword => filename.includes(keyword))) {
    return true;
  }

  // Check OCR text content
  const textContent = (document.text_content || '').toLowerCase();
  if (approvalKeywords.some(keyword => textContent.includes(keyword))) {
    return true;
  }

  // Check extracted data if available
  try {
    if (textContent.startsWith('ocr extracted data: ')) {
      const extractedData = JSON.parse(textContent.replace('ocr extracted data: ', ''));
      const extractedText = JSON.stringify(extractedData).toLowerCase();
      if (approvalKeywords.some(keyword => extractedText.includes(keyword))) {
        return true;
      }
    }
  } catch (e) {
    // Ignore JSON parsing errors
  }

  // Check docItem data
  const docItemText = JSON.stringify(docItem || {}).toLowerCase();
  if (approvalKeywords.some(keyword => docItemText.includes(keyword))) {
    return true;
  }

  return false;
}

/**
 * Re-evaluate GL status using GPT-4o with comprehensive document analysis
 */
async function reEvaluateWithGPT4o(glItem, linkedDocs, currentAudit, farRules, options = {}) {
  // Import azure chat functionality
  const { azureChat } = await import('./azureService.js').catch(() => ({ azureChat: null }));

  if (!azureChat) {
    throw new Error('Azure GPT-4o service not available');
  }

  // Prepare the context for GPT-4o
  const context = {
    glItem: {
      id: glItem.id,
      description: glItem.description,
      amount: glItem.amount,
      date: glItem.date,
      vendor: glItem.vendor,
      category: glItem.category,
      accountNumber: glItem.accountNumber
    },
    currentAudit: {
      status: currentAudit.status,
      farIssue: currentAudit.farIssue,
      farSection: currentAudit.farSection
    },
    attachedDocuments: linkedDocs.map(({ document, docItem }) => ({
      filename: document.filename,
      documentType: document.doc_type,
      textContent: document.text_content,
      extractedData: docItem,
      confidence: docItem.confidence
    })),
    farRules: farRules.map(rule => ({
      title: rule.title,
      section: rule.section,
      severity: rule.severity,
      keywords: rule.keywords
    }))
  };

  const systemPrompt = `You are a Federal Acquisition Regulation (FAR) compliance auditor. Your task is to re-evaluate the compliance status of a GL entry considering ALL attached documents and their approval information.

Current status meanings:
- RED: Expressly unallowable per FAR
- YELLOW: Limited allowable per FAR (may require additional justification)
- GREEN: Compliant/allowable

Your re-evaluation should consider:
1. The original FAR rule-based assessment
2. Any approval documentation in attached files
3. Whether approvals address the compliance concerns
4. The completeness and authority of approvals

Return ONLY a JSON object with:
{
  "status": "RED|YELLOW|GREEN",
  "farIssue": "description of the issue or 'Compliant'",
  "farSection": "relevant FAR section or empty string",
  "reasoning": "brief explanation of the re-evaluation decision",
  "approvalsFound": true/false,
  "approvalSummary": "summary of approvals found"
}`;

  const userPrompt = `Please re-evaluate this GL entry:

${JSON.stringify(context, null, 2)}

Consider whether the attached documents contain approvals that address any FAR compliance concerns. Approvals from appropriate authorities may change RED to YELLOW/GREEN or YELLOW to GREEN, but only if they specifically address the compliance issue and come from authorized personnel.`;

  try {
    const response = await azureChat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], {
      temperature: 0.1,
      max_tokens: 800,
      jsonMode: true
    });

    if (!response) {
      throw new Error('No response from GPT-4o');
    }

    const evaluation = JSON.parse(response);

    return {
      success: true,
      updatedAudit: {
        status: evaluation.status || currentAudit.status,
        farIssue: evaluation.farIssue || currentAudit.farIssue,
        farSection: evaluation.farSection || currentAudit.farSection,
        gptReasoning: evaluation.reasoning,
        approvalsFound: evaluation.approvalsFound,
        approvalSummary: evaluation.approvalSummary
      }
    };

  } catch (error) {
    console.error('GPT-4o evaluation error:', error);
    throw error;
  }
}
