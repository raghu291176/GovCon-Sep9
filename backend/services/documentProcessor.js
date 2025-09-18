import axios from 'axios';
import { analyzeReceipt, analyzeInvoice } from './documentIntelligenceService.js';

/**
 * Enhanced document processing with Azure AI Vision object detection
 * 
 * NEW FLOW INTEGRATION:
 * 1. First, detect receipt objects in the image using Azure AI Vision
 * 2. If bounding boxes are found, crop each detected receipt region
 * 3. Process each cropped image through existing classification pipeline
 * 4. Aggregate results from all detected receipts
 * 5. If no detections, fall back to processing original image as before
 */

async function processDocument(imageBuffer, tesseractResult, options = {}) {
    const processingStartTime = Date.now();

    // Validate inputs
    if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
        throw new Error('Invalid image buffer provided to document processor');
    }

    const extractedText = String(tesseractResult?.rawText || tesseractResult?.extractedText || '').toLowerCase();

    console.log('Starting basic document processing with classification...');
    
    try {
        // Step 1: Classify document using Tesseract OCR result
        const { classifyOCRContent } = await import('./ocrService.js');
        let classification = classifyOCRContent({ success: !!tesseractResult?.success, rawText: extractedText });
        // If OCR failed or is empty (common for PDFs), infer by filename keywords
        if ((!classification || classification.documentType === 'other' || classification.documentType === 'unknown') && options.filename) {
            const inferred = inferDocTypeByFilename(options.filename);
            if (inferred) classification = { ...classification, documentType: inferred };
        }
        
        console.log(`Document classified as: ${classification.documentType} (confidence: ${classification.confidence})`);
        
        // Step 2: Process based on classification using Document Intelligence
        let result;
        // Routing rules:
        // - Invoice -> Document Intelligence Invoice processing
        // - Receipt -> Document Intelligence Receipt processing
        // - Other -> If Tesseract failed (low text/conf), use Mistral; else extract via regex from OCR text
        const tesseractFailed = isTesseractFailed(tesseractResult);
        const isPDF = options.fileType && /pdf/i.test(options.fileType || '');
        if (classification.documentType === 'receipt') {
            console.log('Processing as Receipt with Document Intelligence...');
            try {
                result = await analyzeReceipt(imageBuffer);
            } catch (error) {
                console.log('Document Intelligence failed, falling back to OCR text extraction...');
                result = extractFromTextRegex(extractedText, 'receipt');
            }
        } else if (classification.documentType === 'invoice') {
            console.log('Processing as Invoice with Document Intelligence...');
            try {
                result = await analyzeInvoice(imageBuffer);
            } catch (error) {
                console.log('Document Intelligence failed, falling back to OCR text extraction...');
                result = extractFromTextRegex(extractedText, 'invoice');
            }
        } else {
            if (tesseractFailed && !isPDF) {
                console.log('Tesseract failed/weak; using Azure Foundry Mistral OCR...');
                result = await processWithMistralOCR(imageBuffer, { mimeType: options.fileType });
            } else {
                console.log('Using OCR text regex extraction for unknown type...');
                if (isPDF) {
                    // For PDFs, extract using regex based on filename inference
                    const docType = inferDocTypeByFilename(options.filename) || 'receipt';
                    result = extractFromTextRegex(extractedText, docType);
                } else {
                    result = extractFromTextRegex(extractedText, 'other');
                }
            }
        }
        
        // Add classification metadata to result
        if (result.success) {
            result.classification = classification;
            result.processing_time_ms = Date.now() - processingStartTime;
        }
        
        return result;
        
    } catch (error) {
        const processingTime = Date.now() - processingStartTime;
        console.error('Document processing failed:', error.message);
        
        return {
            method: 'classification_processing_failed',
            success: false,
            error: error.message,
            processing_time_ms: processingTime
        };
    }
}

// Note: Image cropping/detections support is deferred. We process the original
// uploaded image/document as-is with OCR + Document Intelligence/Mistral.

/**
 * Original document processing logic (unchanged for backward compatibility)
 */
async function processOriginalImage(imageBuffer, extractedText, options = {}) {
    console.log('Processing with original method...');
    
    const startTime = Date.now();
    let result;
    
    if (extractedText.includes('receipt')) {
        result = await processWithDocumentIntelligenceReceipt(imageBuffer);
    } else if (extractedText.includes('invoice')) {
        result = await processWithDocumentIntelligenceInvoice(imageBuffer);
    } else {
        result = await processWithMistralOCR(imageBuffer);
    }
    
    // Add fallback metadata if this was a fallback operation
    if (options.fallback_reason) {
        result.fallback_info = {
            reason: options.fallback_reason,
            detection_attempted: options.detection_attempted || false,
            cropping_error: options.cropping_error,
            processing_time_detection_ms: options.processing_time_detection_ms
        };
    }
    
    const processingTime = Date.now() - startTime;
    result.processing_time_ms = processingTime;
    
    return result;
}

// Note: processWithDocumentIntelligenceReceipt and processWithDocumentIntelligenceInvoice
// are now handled by the Document Intelligence service

async function processWithMistralOCR(imageBuffer, options = {}) {
    if (!process.env.AZURE_FOUNDRY_MISTRAL_ENDPOINT || !process.env.AZURE_FOUNDRY_MISTRAL_KEY) {
        return {
            method: 'azure_foundry_mistral_ocr',
            success: false,
            error: 'Azure Foundry Mistral OCR not configured (AZURE_FOUNDRY_MISTRAL_ENDPOINT and AZURE_FOUNDRY_MISTRAL_KEY required)'
        };
    }
    
    try {
        console.log('Processing with Azure Foundry Mistral OCR...');

        // Azure Foundry API call format - OpenAI compatible
        const response = await axios.post(process.env.AZURE_FOUNDRY_MISTRAL_ENDPOINT, {
            model: process.env.AZURE_FOUNDRY_MISTRAL_MODEL || "mistral-document-ai-2505",
            messages: [{
                role: "user",
                content: [
                    {
                        type: "text",
                        text: "Extract the amount, date, and merchant/vendor name from this document. Also provide the raw OCR text from the document. Return in JSON format with fields: amount, date, merchant, rawOcrText."
                    },
                    {
                        type: "image_url",
                        image_url: {
                            url: `data:${options.mimeType || 'image/jpeg'};base64,${imageBuffer.toString('base64')}`
                        }
                    }
                ]
            }],
            max_tokens: 500,
            temperature: 0.1,
            stream: false
        }, {
            headers: (() => {
                const key = process.env.AZURE_FOUNDRY_MISTRAL_KEY;
                const scheme = String(process.env.AZURE_FOUNDRY_MISTRAL_AUTH_SCHEME || 'api-key').toLowerCase();
                const base = {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                };
                if (scheme === 'bearer') {
                    return { ...base, 'Authorization': `Bearer ${key}` };
                }
                // Default to Azure-style api-key header
                return { ...base, 'api-key': key };
            })(),
            timeout: 60000
        });
        
        console.log('Azure Foundry Mistral OCR completed successfully');
        
        return {
            method: 'azure_foundry_mistral_ocr',
            success: true,
            data: extractMistralData(response.data)
        };
    } catch (error) {
        console.error('Azure Foundry Mistral OCR Processing Error:', error);
        return {
            method: 'azure_foundry_mistral_ocr',
            success: false,
            error: error.message
        };
    }
}

// Note: extractReceiptData and extractInvoiceData - Document Intelligence handles extraction internally

function extractMistralData(mistralResponse) {
    try {
        // Azure Foundry Mistral returns response in OpenAI format
        const content = mistralResponse?.choices?.[0]?.message?.content;
        if (!content) {
            console.warn('No content found in Mistral response');
            return {
                amount: { value: null, confidence: 0 },
                date: { value: null, confidence: 0 },
                merchant: { value: null, confidence: 0 },
                confidence: 0,
                rawMistralResponse: null
            };
        }

        // Return the raw Mistral response as-is for 'other' document types
        // This preserves the classification and information provided by Mistral
        let extractedData;
        try {
            extractedData = JSON.parse(content);
        } catch (parseError) {
            // If not valid JSON, treat the content as raw text classification
            console.log('Mistral returned non-JSON response, treating as raw classification');
            return {
                amount: { value: null, confidence: 0 },
                date: { value: null, confidence: 0 },
                merchant: { value: null, confidence: 0 },
                confidence: 0.8, // High confidence for raw Mistral classification
                rawMistralResponse: content,
                mistralClassification: content,
                documentType: 'other'
            };
        }

        // If we have structured JSON data, check if it contains classification info
        if (extractedData.documentType || extractedData.classification || extractedData.category) {
            // Return Mistral's classification as-is with minimal processing
            return {
                amount: extractedData.amount ? normalizeAmount(extractedData.amount) : { value: null, confidence: 0 },
                date: extractedData.date ? normalizeDate(extractedData.date) : { value: null, confidence: 0 },
                merchant: extractedData.merchant || extractedData.vendor ? normalizeMerchant(extractedData.merchant || extractedData.vendor) : { value: null, confidence: 0 },
                confidence: extractedData.confidence || 0.8,
                rawMistralResponse: content,
                rawOcrText: extractedData.rawOcrText || null, // Include raw OCR text from Mistral
                mistralClassification: extractedData.documentType || extractedData.classification || extractedData.category,
                documentType: 'other',
                mistralData: extractedData // Preserve all Mistral data
            };
        }

        // Fallback to old behavior for receipt/invoice-like responses
        const normalizedAmount = normalizeAmount(extractedData.amount);
        const normalizedDate = normalizeDate(extractedData.date);
        const normalizedMerchant = normalizeMerchant(extractedData.merchant);

        // Calculate confidence based on how many fields were successfully extracted
        const extractedFields = [normalizedAmount.value, normalizedDate.value, normalizedMerchant.value].filter(v => v !== null).length;
        const overallConfidence = extractedFields / 3; // 3 fields total

        return {
            amount: normalizedAmount,
            date: normalizedDate,
            merchant: normalizedMerchant,
            confidence: overallConfidence,
            rawMistralResponse: content,
            rawOcrText: extractedData.rawOcrText || null, // Include raw OCR text from Mistral
            mistralData: extractedData
        };

    } catch (error) {
        console.error('Error extracting Mistral data:', error);
        return {
            amount: { value: null, confidence: 0 },
            date: { value: null, confidence: 0 },
            merchant: { value: null, confidence: 0 },
            confidence: 0,
            rawMistralResponse: null,
            error: error.message
        };
    }
}

function extractWithRegex(content) {
    // Fallback regex extraction if JSON parsing fails
    const amountMatch = content.match(/(?:amount|total|sum)[:\s]*\$?([0-9]+\.?[0-9]*)/i);
    const dateMatch = content.match(/(?:date)[:\s]*([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i);
    const merchantMatch = content.match(/(?:merchant|vendor|company)[:\s]*([a-zA-Z0-9\s]+)/i);

    return {
        amount: amountMatch ? amountMatch[1] : null,
        date: dateMatch ? dateMatch[1] : null,
        merchant: merchantMatch ? merchantMatch[1].trim() : null
    };
}

function inferDocTypeByFilename(name) {
    try {
        const n = String(name || '').toLowerCase();
        if (/(invoice|inv[-_\s]?\d+)/i.test(n)) return 'invoice';
        if (/(receipt|rcpt|pos[-_\s]?\d+)/i.test(n)) return 'receipt';
        return null;
    } catch (_) { return null; }
}

function isTesseractFailed(ocr) {
    try {
        if (!ocr || !ocr.success) return true;
        const len = String(ocr.rawText || ocr.extractedText || '').trim().length;
        if (len < 20) return true; // Reduced from 50 to 20 - even short receipts can be valid
        const conf = Number(ocr.confidence || 0);
        // Reduced confidence threshold from 50 to 30 for better performance
        // Tesseract often produces useful results even with lower confidence
        if (conf > 0 && conf < 30) return true; // confidence is 0-100 for tesseract.js
        return false;
    } catch (_) {
        return true;
    }
}

function extractFromTextRegex(text, docType = 'receipt') {
    try {
        const extracted = extractWithRegex(String(text || ''));
        const normalizedAmount = normalizeAmount(extracted.amount);
        const normalizedDate = normalizeDate(extracted.date);
        const normalizedMerchant = normalizeMerchant(extracted.merchant);

        // Extract description from text (simple approach)
        const description = extractDescription(text, docType);
        const summary = createSummary(normalizedMerchant.value, normalizedAmount.value, normalizedDate.value, docType);

        const extractedFields = [normalizedAmount.value, normalizedDate.value, normalizedMerchant.value].filter(v => v !== null).length;
        const overallConfidence = extractedFields / 3;

        return {
            method: 'tesseract_regex',
            success: true,
            data: {
                amount: normalizedAmount,
                date: normalizedDate,
                merchant: normalizedMerchant,
                description: description,
                summary: summary,
                confidence: overallConfidence
            }
        };
    } catch (error) {
        return {
            method: 'tesseract_regex',
            success: false,
            error: error.message
        };
    }
}

function normalizeAmount(amount) {
    if (!amount) return { value: null, confidence: 0 };
    
    const numericAmount = parseFloat(amount.toString().replace(/[^0-9.]/g, ''));
    if (isNaN(numericAmount)) return { value: null, confidence: 0 };
    
    return { value: numericAmount, confidence: 0.7 }; // Medium confidence for Mistral extractions
}

function normalizeDate(date) {
    if (!date) return { value: null, confidence: 0 };
    
    try {
        const parsedDate = new Date(date);
        if (isNaN(parsedDate)) return { value: null, confidence: 0 };
        
        return { value: parsedDate.toISOString().split('T')[0], confidence: 0.6 }; // Lower confidence for dates
    } catch (error) {
        return { value: null, confidence: 0 };
    }
}

function normalizeMerchant(merchant) {
    if (!merchant) return { value: null, confidence: 0 };
    
    const cleanMerchant = merchant.toString().trim().replace(/[^\w\s]/g, '').substring(0, 50);
    if (cleanMerchant.length === 0) return { value: null, confidence: 0 };
    
    return { value: cleanMerchant, confidence: 0.5 }; // Lower confidence for merchant names from OCR
}

// Note: calculateConfidence - Document Intelligence provides confidence internally

/**
 * Extract description from OCR text
 */
function extractDescription(text, docType) {
    if (!text) return { value: null, confidence: 0 };

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Look for item descriptions (words that might be products/services)
    const possibleDescriptions = lines.filter(line => {
        // Skip lines that are obviously amounts, dates, or addresses
        if (/^\$?\d+\.?\d*$/.test(line)) return false; // amounts
        if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(line)) return false; // dates
        if (line.length < 3) return false; // too short
        if (line.length > 100) return false; // too long
        return true;
    });

    if (possibleDescriptions.length > 0) {
        // Take the first few relevant items
        const description = possibleDescriptions.slice(0, 3).join('; ');
        return {
            value: description,
            confidence: 0.6
        };
    }

    return { value: null, confidence: 0 };
}

/**
 * Create a summary from extracted fields
 */
function createSummary(merchant, amount, date, docType) {
    const parts = [];
    const docTypeName = docType === 'invoice' ? 'Invoice' : 'Receipt';

    if (merchant) {
        parts.push(`${docTypeName} from ${merchant}`);
    } else {
        parts.push(`${docTypeName}`);
    }

    if (amount) {
        parts.push(`Total: $${amount}`);
    }

    if (date) {
        parts.push(`Date: ${date}`);
    }

    if (parts.length > 1) {
        return {
            value: parts.join(' | '),
            confidence: 0.7
        };
    }

    return { value: null, confidence: 0 };
}

export {
    processDocument,
    processWithMistralOCR
};
