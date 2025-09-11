import axios from 'axios';
import { azureVisionService } from './azureVisionService.js';
import { imageCroppingService } from './imageCroppingService.js';

const apiVersion = "2024-07-31-preview";

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
    
    console.log('Starting enhanced document processing with receipt detection...');
    
    try {
        // Step 1: Attempt receipt detection using Azure AI Vision
        const detectionResult = await azureVisionService.detectReceiptObjects(imageBuffer, {
            tesseract_classification: extractedText.includes('receipt') ? 'receipt' : 
                                    extractedText.includes('invoice') ? 'invoice' : 'unknown'
        });
        
        // Step 2: Process based on detection results
        if (detectionResult.success && detectionResult.detections.length > 0) {
            console.log(`Found ${detectionResult.detections.length} receipt objects, processing each...`);
            return await processDetectedReceipts(imageBuffer, detectionResult.detections, extractedText, options);
        } else {
            // Step 3: No detections found, fall back to original processing logic
            console.log('No receipt objects detected, falling back to original processing...');
            return await processOriginalImage(imageBuffer, extractedText, {
                ...options,
                fallback_reason: detectionResult.error || 'no_detections_found',
                detection_attempted: true
            });
        }
        
    } catch (error) {
        const processingTime = Date.now() - processingStartTime;
        console.error('Enhanced document processing failed, falling back to original:', error.message);
        
        // Fallback to original processing on any error
        try {
            return await processOriginalImage(imageBuffer, extractedText, {
                ...options,
                fallback_reason: error.message,
                detection_attempted: true,
                processing_time_detection_ms: processingTime
            });
        } catch (fallbackError) {
            // If even fallback fails, return error
            return {
                method: 'enhanced_processing_failed',
                success: false,
                error: `Both enhanced and fallback processing failed: ${error.message}, ${fallbackError.message}`,
                processing_time_ms: Date.now() - processingStartTime
            };
        }
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

async function processWithDocumentIntelligenceReceipt(imageBuffer) {
    if (!process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || !process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY) {
        return {
            method: 'document_intelligence_receipt',
            success: false,
            error: 'Azure Document Intelligence not configured'
        };
    }
    
    try {
        const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT.replace(/\/$/, '');
        const analyzeUrl = `${endpoint}/formrecognizer/documentModels/prebuilt-receipt:analyze?api-version=${apiVersion}`;
        
        // Start the analysis
        const analyzeResponse = await axios.post(analyzeUrl, imageBuffer, {
            headers: {
                'Content-Type': 'application/octet-stream',
                'Ocp-Apim-Subscription-Key': process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY
            }
        });
        
        // Get the operation location from the response headers
        const operationLocation = analyzeResponse.headers['operation-location'];
        if (!operationLocation) {
            throw new Error('No operation location returned from Document Intelligence');
        }
        
        // Poll for results
        let result;
        let attempts = 0;
        const maxAttempts = 30;
        
        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
            
            const resultResponse = await axios.get(operationLocation, {
                headers: {
                    'Ocp-Apim-Subscription-Key': process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY
                }
            });
            
            if (resultResponse.data.status === 'succeeded') {
                result = resultResponse.data;
                break;
            } else if (resultResponse.data.status === 'failed') {
                throw new Error(`Analysis failed: ${resultResponse.data.error?.message || 'Unknown error'}`);
            }
            
            attempts++;
        }
        
        if (!result || result.status !== 'succeeded') {
            throw new Error('Analysis timed out or failed');
        }
        
        return {
            method: 'document_intelligence_receipt',
            success: true,
            data: await extractReceiptData(result)
        };
        
    } catch (error) {
        console.error('Document Intelligence Receipt Processing Error:', error);
        return {
            method: 'document_intelligence_receipt',
            success: false,
            error: error.message
        };
    }
}

async function processWithDocumentIntelligenceInvoice(imageBuffer) {
    if (!process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || !process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY) {
        return {
            method: 'document_intelligence_invoice',
            success: false,
            error: 'Azure Document Intelligence not configured'
        };
    }
    
    try {
        const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT.replace(/\/$/, '');
        const analyzeUrl = `${endpoint}/formrecognizer/documentModels/prebuilt-invoice:analyze?api-version=${apiVersion}`;
        
        // Start the analysis
        const analyzeResponse = await axios.post(analyzeUrl, imageBuffer, {
            headers: {
                'Content-Type': 'application/octet-stream',
                'Ocp-Apim-Subscription-Key': process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY
            }
        });
        
        // Get the operation location from the response headers
        const operationLocation = analyzeResponse.headers['operation-location'];
        if (!operationLocation) {
            throw new Error('No operation location returned from Document Intelligence');
        }
        
        // Poll for results
        let result;
        let attempts = 0;
        const maxAttempts = 30;
        
        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
            
            const resultResponse = await axios.get(operationLocation, {
                headers: {
                    'Ocp-Apim-Subscription-Key': process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY
                }
            });
            
            if (resultResponse.data.status === 'succeeded') {
                result = resultResponse.data;
                break;
            } else if (resultResponse.data.status === 'failed') {
                throw new Error(`Analysis failed: ${resultResponse.data.error?.message || 'Unknown error'}`);
            }
            
            attempts++;
        }
        
        if (!result || result.status !== 'succeeded') {
            throw new Error('Analysis timed out or failed');
        }
        
        return {
            method: 'document_intelligence_invoice',
            success: true,
            data: await extractInvoiceData(result)
        };
        
    } catch (error) {
        console.error('Document Intelligence Invoice Processing Error:', error);
        return {
            method: 'document_intelligence_invoice',
            success: false,
            error: error.message
        };
    }
}

async function processWithMistralOCR(imageBuffer) {
    if (!process.env.MISTRAL_OCR_ENDPOINT || !process.env.MISTRAL_API_KEY) {
        return {
            method: 'mistral_ocr',
            success: false,
            error: 'Mistral OCR not configured'
        };
    }
    
    try {
        const response = await axios.post(process.env.MISTRAL_OCR_ENDPOINT, {
            image: imageBuffer.toString('base64'),
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
        
        return {
            method: 'mistral_ocr',
            success: true,
            data: extractMistralData(response.data)
        };
    } catch (error) {
        console.error('Mistral OCR Processing Error:', error);
        return {
            method: 'mistral_ocr',
            success: false,
            error: error.message
        };
    }
}

async function extractReceiptData(diResult) {
    const { extractAmount, extractDate, extractMerchant } = await import('./dataExtraction.js');
    
    if (!diResult.analyzeResult?.documents || diResult.analyzeResult.documents.length === 0) {
        return {
            amount: { value: null, confidence: 0 },
            date: { value: null, confidence: 0 },
            merchant: { value: null, confidence: 0 }
        };
    }
    
    const receipt = diResult.analyzeResult.documents[0];
    const fields = receipt.fields || {};
    
    return {
        amount: extractAmount(fields),
        date: extractDate(fields),
        merchant: extractMerchant(fields),
        confidence: calculateConfidence(fields)
    };
}

async function extractInvoiceData(diResult) {
    const { extractAmount, extractDate, extractVendor } = await import('./dataExtraction.js');
    
    if (!diResult.analyzeResult?.documents || diResult.analyzeResult.documents.length === 0) {
        return {
            amount: { value: null, confidence: 0 },
            date: { value: null, confidence: 0 },
            merchant: { value: null, confidence: 0 }
        };
    }
    
    const invoice = diResult.analyzeResult.documents[0];
    const fields = invoice.fields || {};
    
    return {
        amount: extractAmount(fields),
        date: extractDate(fields),
        merchant: extractVendor(fields),
        confidence: calculateConfidence(fields)
    };
}

function extractMistralData(mistralResponse) {
    return {
        amount: { value: null, confidence: 0 },
        date: { value: null, confidence: 0 },
        merchant: { value: null, confidence: 0 },
        confidence: 0
    };
}

function calculateConfidence(fields) {
    const confidences = Object.values(fields)
        .filter(field => field && field.confidence)
        .map(field => field.confidence);
    
    if (confidences.length === 0) return 0;
    
    return confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length;
}

export {
    processDocument,
    processWithDocumentIntelligenceReceipt,
    processWithDocumentIntelligenceInvoice,
    processWithMistralOCR
};