import { performTesseractOCR } from './ocrService.js';
import { processDocument } from './documentProcessor.js';
import { findGLMatches, preprocessGLEntries } from './glMatcher.js';

function generateDocumentId() {
    return `DOC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

async function processDocumentWorkflow(imageBuffer, glEntries, options = {}) {
    const documentId = generateDocumentId();
    const startTime = Date.now();
    
    try {
        console.log(`[${documentId}] Starting document processing workflow`);
        
        const tesseractResult = await performTesseractOCR(imageBuffer);
        if (!tesseractResult.success) {
            throw new Error(`Tesseract OCR failed: ${tesseractResult.error}`);
        }
        
        console.log(`[${documentId}] Tesseract OCR completed successfully`);
        
        const processingResult = await processDocument(imageBuffer, tesseractResult.extractedText);
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
                confidence_scores: {
                    amount: processingResult.data.amount.confidence,
                    date: processingResult.data.date.confidence,
                    merchant: processingResult.data.merchant.confidence,
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
                    documentName: document.name || `document_${i + 1}`
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