import axios from 'axios';
import { analyzeDocument as analyzeWithContentUnderstanding } from './contentUnderstandingService.js';

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

async function processDocument(imageBuffer, tesseractText, options = {}) {
    const processingStartTime = Date.now();
    const extractedText = tesseractText.toLowerCase();
    
    console.log('Starting basic document processing with classification...');
    
    try {
        // Step 1: Classify document using Tesseract OCR result
        const { classifyOCRContent } = await import('./ocrService.js');
        const classification = classifyOCRContent({ success: true, rawText: tesseractText });
        
        console.log(`Document classified as: ${classification.documentType} (confidence: ${classification.confidence})`);
        
        // Step 2: Process based on classification using Content Understanding
        let result;
        if (classification.documentType === 'receipt') {
            console.log('Processing as Receipt with Content Understanding...');
            const receiptAnalyzerId = process.env.CONTENT_UNDERSTANDING_RECEIPT_ANALYZER_ID || 'receipt-analyzer';
            result = await analyzeWithContentUnderstanding(receiptAnalyzerId, imageBuffer);
        } else if (classification.documentType === 'invoice') {
            console.log('Processing as Invoice with Content Understanding...');
            const invoiceAnalyzerId = process.env.CONTENT_UNDERSTANDING_INVOICE_ANALYZER_ID || 'invoice-analyzer';
            result = await analyzeWithContentUnderstanding(invoiceAnalyzerId, imageBuffer);
        } else {
            console.log('Processing as Other document with Azure Foundry Mistral OCR...');
            result = await processWithMistralOCR(imageBuffer);
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

/**
 * Process multiple detected receipts by cropping and running through pipeline
 */
async function processDetectedReceipts(imageBuffer, detections, tesseractText, options = {}) {
    const startTime = Date.now();
    
    try {
        // Step 1: Crop all detected receipt regions
        const croppingResult = await imageCroppingService.cropDetectedReceipts(
            imageBuffer, 
            detections,
            options
        );
        
        if (!croppingResult.success || croppingResult.cropped_images.length === 0) {
            console.warn('Failed to crop detected receipts, falling back to original image');
            return await processOriginalImage(imageBuffer, tesseractText, {
                ...options,
                fallback_reason: 'cropping_failed',
                cropping_error: croppingResult.error
            });
        }
        
        console.log(`Successfully cropped ${croppingResult.cropped_images.length} receipt regions`);
        
        // Step 2: Process each cropped receipt through existing pipeline
        const processedReceipts = [];
        let bestResult = null;
        let bestConfidence = 0;
        
        for (let i = 0; i < croppingResult.cropped_images.length; i++) {
            const croppedImage = croppingResult.cropped_images[i];
            
            if (!croppedImage.success) {
                console.warn(`Skipping failed crop ${i + 1}`);
                continue;
            }
            
            try {
                console.log(`Processing cropped receipt ${i + 1}/${croppingResult.cropped_images.length}...`);
                
                // Determine processing method based on tesseract classification
                let processingResult;
                
                if (tesseractText.includes('receipt')) {
                    processingResult = await processWithDocumentIntelligenceReceipt(croppedImage.buffer);
                } else if (tesseractText.includes('invoice')) {
                    processingResult = await processWithDocumentIntelligenceInvoice(croppedImage.buffer);
                } else {
                    processingResult = await processWithMistralOCR(croppedImage.buffer);
                }
                
                // Enhance result with cropping metadata
                if (processingResult.success) {
                    processingResult.cropping_info = {
                        detection_index: i,
                        detection_id: croppedImage.detection_info.detection_id,
                        detection_confidence: croppedImage.detection_info.confidence,
                        original_bbox: croppedImage.detection_info.original_bbox,
                        cropped_dimensions: croppedImage.dimensions
                    };
                    
                    processedReceipts.push(processingResult);
                    
                    // Track best result by confidence
                    const resultConfidence = processingResult.data?.confidence || 0;
                    if (resultConfidence > bestConfidence) {
                        bestResult = processingResult;
                        bestConfidence = resultConfidence;
                    }
                    
                    console.log(`Successfully processed cropped receipt ${i + 1} (confidence: ${resultConfidence.toFixed(2)})`);
                } else {
                    console.warn(`Failed to process cropped receipt ${i + 1}: ${processingResult.error}`);
                }
                
            } catch (cropProcessingError) {
                console.error(`Error processing cropped receipt ${i + 1}:`, cropProcessingError.message);
            }
        }
        
        // Step 3: Return aggregated results
        if (processedReceipts.length === 0) {
            console.warn('No cropped receipts processed successfully, falling back to original');
            return await processOriginalImage(imageBuffer, tesseractText, {
                ...options,
                fallback_reason: 'no_successful_crops'
            });
        }
        
        // Use the best result as primary, but include aggregated metadata
        const processingTime = Date.now() - startTime;
        
        return {
            ...bestResult,
            method: `enhanced_${bestResult.method}`,
            enhanced_processing: {
                total_detections: detections.length,
                successful_crops: croppingResult.cropped_images.filter(c => c.success).length,
                successful_extractions: processedReceipts.length,
                best_confidence: bestConfidence,
                all_results: processedReceipts.map(r => ({
                    method: r.method,
                    confidence: r.data?.confidence || 0,
                    detection_id: r.cropping_info?.detection_id,
                    amount: r.data?.amount?.value,
                    merchant: r.data?.merchant?.value,
                    date: r.data?.date?.value
                })),
                processing_time_ms: processingTime,
                cropping_metadata: croppingResult.metadata
            }
        };
        
    } catch (error) {
        console.error('Error in processDetectedReceipts:', error.message);
        throw error;
    }
}

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

// Removed: processWithDocumentIntelligenceReceipt - replaced with Content Understanding

// Removed: processWithDocumentIntelligenceInvoice - replaced with Content Understanding

async function processWithMistralOCR(imageBuffer) {
    if (!process.env.AZURE_FOUNDRY_MISTRAL_ENDPOINT || !process.env.AZURE_FOUNDRY_MISTRAL_KEY) {
        return {
            method: 'azure_foundry_mistral_ocr',
            success: false,
            error: 'Azure Foundry Mistral OCR not configured (AZURE_FOUNDRY_MISTRAL_ENDPOINT and AZURE_FOUNDRY_MISTRAL_KEY required)'
        };
    }
    
    try {
        console.log('Processing with Azure Foundry Mistral OCR...');
        
        // Azure Foundry API call format
        const response = await axios.post(process.env.AZURE_FOUNDRY_MISTRAL_ENDPOINT, {
            model: "mistral-ocr", // or the specific model name
            messages: [{
                role: "user",
                content: [
                    {
                        type: "text", 
                        text: "Extract the amount, date, and merchant/vendor name from this document. Return in JSON format with fields: amount, date, merchant."
                    },
                    {
                        type: "image_url",
                        image_url: {
                            url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`
                        }
                    }
                ]
            }],
            max_tokens: 500,
            temperature: 0.1
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.AZURE_FOUNDRY_MISTRAL_KEY}`,
                'Content-Type': 'application/json'
            },
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

// Removed: extractReceiptData and extractInvoiceData - Content Understanding handles extraction internally

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
                confidence: 0
            };
        }

        // Try to parse JSON from the response
        let extractedData;
        try {
            extractedData = JSON.parse(content);
        } catch (parseError) {
            // If not valid JSON, try to extract information with regex
            console.log('Failed to parse JSON, attempting regex extraction');
            extractedData = extractWithRegex(content);
        }

        // Normalize the extracted data
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
            confidence: overallConfidence
        };

    } catch (error) {
        console.error('Error extracting Mistral data:', error);
        return {
            amount: { value: null, confidence: 0 },
            date: { value: null, confidence: 0 },
            merchant: { value: null, confidence: 0 },
            confidence: 0
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

// Removed: calculateConfidence - Content Understanding provides confidence internally

export {
    processDocument,
    processWithMistralOCR
};