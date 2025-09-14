import { performTesseractOCR } from './ocrService.js';
import { processDocument } from './documentProcessor.js';
import { findGLMatches, preprocessGLEntries } from './glMatcher.js';

function generateDocumentId() {
    return `DOC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

async function processDocumentWorkflow(imageBuffer, glEntries, options = {}) {
    const documentId = generateDocumentId();
    const startTime = Date.now();
    const isPDF = options.fileType && /pdf/i.test(options.fileType);

    try {
        console.log(`[${documentId}] Starting document processing workflow`);

        let tesseractResult = null;

        // Skip Tesseract OCR for PDF files as it doesn't support them
        if (isPDF) {
            console.log(`[${documentId}] Skipping Tesseract OCR for PDF file`);
            tesseractResult = {
                success: false,
                extractedText: '',
                rawText: '',
                confidence: 0
            };
        } else {
            tesseractResult = await performTesseractOCR(imageBuffer);
            if (!tesseractResult.success) {
                throw new Error(`Tesseract OCR failed: ${tesseractResult.error}`);
            }
            console.log(`[${documentId}] Tesseract OCR completed successfully`);
        }

        const processingResult = await processDocument(imageBuffer, tesseractResult, { fileType: options.fileType, filename: options.filename });
        if (!processingResult.success) {
            throw new Error(`Document processing failed: ${processingResult.error}`);
        }
        
        console.log(`[${documentId}] Document processing completed with method: ${processingResult.method}`);
        
        const processedGLEntries = preprocessGLEntries(glEntries);
        console.log(`[${documentId}] Preprocessed ${processedGLEntries.length} GL entries`);
        
        const matchOptions = {
            maxDateDiff: options.maxDateDiff || 14,
            maxAmountDiff: options.maxAmountDiff || 50.00,
            minScore: options.minScore || 50,
            maxResults: options.maxResults || 10
        };
        
        const glMatches = await findGLMatches(processingResult.data, processedGLEntries, matchOptions);
        console.log(`[${documentId}] Found ${glMatches.length} GL matches`);
        
        const processingTime = Date.now() - startTime;
        
        const result = {
            document_id: documentId,
            processing_method: processingResult.method,
            processing_time_ms: processingTime,
            extracted_data: {
                amount: processingResult.data.amount.value,
                date: processingResult.data.date.value,
                merchant: processingResult.data.merchant.value,
                description: processingResult.data.description?.value || null,
                summary: processingResult.data.summary?.value || null,
                // Additional receipt fields (will be null for invoices)
                receiptType: processingResult.data.receiptType?.value || null,
                merchantPhone: processingResult.data.merchantPhone?.value || null,
                merchantAddress: processingResult.data.merchantAddress?.value || null,
                transactionTime: processingResult.data.transactionTime?.value || null,
                subtotal: processingResult.data.subtotal?.value || null,
                tax: processingResult.data.tax?.value || null,
                tip: processingResult.data.tip?.value || null,
                // Additional invoice fields (will be null for receipts)
                invoiceId: processingResult.data.invoiceId?.value || null,
                customerName: processingResult.data.customerName?.value || null,
                billingAddress: processingResult.data.billingAddress?.value || null,
                subTotal: processingResult.data.subTotal?.value || null,
                dueDate: processingResult.data.dueDate?.value || null,
                confidence_scores: {
                    amount: processingResult.data.amount.confidence,
                    date: processingResult.data.date.confidence,
                    merchant: processingResult.data.merchant.confidence,
                    description: processingResult.data.description?.confidence || 0,
                    summary: processingResult.data.summary?.confidence || 0,
                    // Receipt-specific confidence scores
                    receiptType: processingResult.data.receiptType?.confidence || 0,
                    merchantPhone: processingResult.data.merchantPhone?.confidence || 0,
                    merchantAddress: processingResult.data.merchantAddress?.confidence || 0,
                    transactionTime: processingResult.data.transactionTime?.confidence || 0,
                    subtotal: processingResult.data.subtotal?.confidence || 0,
                    tax: processingResult.data.tax?.confidence || 0,
                    tip: processingResult.data.tip?.confidence || 0,
                    // Invoice-specific confidence scores
                    invoiceId: processingResult.data.invoiceId?.confidence || 0,
                    customerName: processingResult.data.customerName?.confidence || 0,
                    billingAddress: processingResult.data.billingAddress?.confidence || 0,
                    subTotal: processingResult.data.subTotal?.confidence || 0,
                    dueDate: processingResult.data.dueDate?.confidence || 0,
                    overall: processingResult.data.confidence || 0
                }
            },
            gl_matches: glMatches,
            processing_status: 'success',
            error_messages: [],
            metadata: {
                timestamp: new Date().toISOString(),
                tesseract_text_length: tesseractResult.rawText.length,
                gl_entries_processed: processedGLEntries.length,
                match_options: matchOptions
            },
            ocr_data: {
                raw_text: tesseractResult.rawText || '',
                success: tesseractResult.success,
                confidence: tesseractResult.confidence || 0,
                method: isPDF ? 'skipped_pdf' : 'tesseract'
            }
        };
        
        console.log(`[${documentId}] Workflow completed successfully in ${processingTime}ms`);
        return result;
        
    } catch (error) {
        const processingTime = Date.now() - startTime;
        console.error(`[${documentId}] Workflow failed:`, error);

        return {
            document_id: documentId,
            processing_method: 'unknown',
            processing_time_ms: processingTime,
            extracted_data: null,
            gl_matches: [],
            processing_status: 'failed',
            error_messages: [error.message],
            metadata: {
                timestamp: new Date().toISOString(),
                failure_stage: identifyFailureStage(error.message)
            },
            ocr_data: {
                raw_text: '',
                success: false,
                confidence: 0,
                method: isPDF ? 'skipped_pdf' : 'failed'
            }
        };
    }
}

function identifyFailureStage(errorMessage) {
    const errorMessage_lower = errorMessage.toLowerCase();
    
    if (errorMessage_lower.includes('tesseract')) {
        return 'ocr';
    } else if (errorMessage_lower.includes('azure') || errorMessage_lower.includes('form recognizer')) {
        return 'azure_processing';
    } else if (errorMessage_lower.includes('mistral')) {
        return 'mistral_processing';
    } else if (errorMessage_lower.includes('gl') || errorMessage_lower.includes('match')) {
        return 'gl_matching';
    } else {
        return 'unknown';
    }
}

async function batchProcessDocuments(documents, glEntries, options = {}) {
    const results = [];
    const batchId = `BATCH-${Date.now()}`;
    const processedGLEntries = preprocessGLEntries(glEntries);
    
    console.log(`[${batchId}] Starting batch processing of ${documents.length} documents`);
    
    for (let i = 0; i < documents.length; i++) {
        const document = documents[i];
        console.log(`[${batchId}] Processing document ${i + 1}/${documents.length}`);
        
        try {
            const result = await processDocumentWorkflow(
                document.buffer,
                processedGLEntries,
                {
                    ...options,
                    documentName: document.name || `document_${i + 1}`,
                    fileType: document.mimetype
                }
            );
            
            result.batch_info = {
                batch_id: batchId,
                document_index: i,
                document_name: document.name || `document_${i + 1}`
            };
            
            results.push(result);
            
        } catch (error) {
            console.error(`[${batchId}] Failed to process document ${i + 1}:`, error);
            
            results.push({
                document_id: `DOC-FAILED-${i}`,
                processing_status: 'failed',
                error_messages: [error.message],
                batch_info: {
                    batch_id: batchId,
                    document_index: i,
                    document_name: document.name || `document_${i + 1}`
                }
            });
        }
    }
    
    const successCount = results.filter(r => r.processing_status === 'success').length;
    console.log(`[${batchId}] Batch processing completed: ${successCount}/${documents.length} successful`);
    
    return {
        batch_id: batchId,
        total_documents: documents.length,
        successful_documents: successCount,
        failed_documents: documents.length - successCount,
        results: results,
        processing_summary: generateBatchSummary(results)
    };
}

function generateBatchSummary(results) {
    const summary = {
        processing_methods: {},
        total_matches_found: 0,
        average_processing_time: 0,
        confidence_distribution: {
            high: 0,    // > 80%
            medium: 0,  // 50-80%
            low: 0      // < 50%
        }
    };
    
    let totalProcessingTime = 0;
    let successfulResults = results.filter(r => r.processing_status === 'success');
    
    for (const result of successfulResults) {
        if (result.processing_method) {
            summary.processing_methods[result.processing_method] = 
                (summary.processing_methods[result.processing_method] || 0) + 1;
        }
        
        summary.total_matches_found += (result.gl_matches?.length || 0);
        totalProcessingTime += (result.processing_time_ms || 0);
        
        const overallConfidence = result.extracted_data?.confidence_scores?.overall || 0;
        if (overallConfidence > 0.8) {
            summary.confidence_distribution.high++;
        } else if (overallConfidence > 0.5) {
            summary.confidence_distribution.medium++;
        } else {
            summary.confidence_distribution.low++;
        }
    }
    
    if (successfulResults.length > 0) {
        summary.average_processing_time = Math.round(totalProcessingTime / successfulResults.length);
    }
    
    return summary;
}

export {
    processDocumentWorkflow,
    batchProcessDocuments,
    generateDocumentId,
    identifyFailureStage,
    generateBatchSummary
};
