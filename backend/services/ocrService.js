import { createWorker } from 'tesseract.js';

/**
 * Enhanced OCR service with support for cropped images
 * 
 * INTEGRATION UPDATES:
 * - Handles both original images and cropped receipt regions
 * - Optimizes OCR parameters based on image characteristics
 * - Provides batch processing for multiple cropped images
 * - Maintains backward compatibility with existing pipeline
 */

async function performTesseractOCR(imageBuffer, options = {}) {
    let worker;
    const startTime = Date.now();
    
    try {
        console.log('Starting Tesseract OCR...');
        worker = await createWorker();
        
        await worker.loadLanguage('eng');
        await worker.initialize('eng');
        
        // Apply OCR optimizations based on image type and options
        const ocrOptions = buildOCROptions(options);
        if (ocrOptions.parameters) {
            for (const [key, value] of Object.entries(ocrOptions.parameters)) {
                await worker.setParameters({ [key]: value });
            }
        }
        
        const recognition = await worker.recognize(imageBuffer, {
            rectangle: options.cropRegion, // Support for specific regions if needed
        });
        
        const { data: { text, confidence, words, lines } } = recognition;
        
        await worker.terminate();
        
        const processingTime = Date.now() - startTime;
        console.log(`Tesseract OCR completed in ${processingTime}ms with confidence: ${confidence}`);
        
        return {
            success: true,
            extractedText: text.toLowerCase(),
            rawText: text,
            confidence: confidence,
            processingTimeMs: processingTime,
            metadata: {
                totalWords: words?.length || 0,
                totalLines: lines?.length || 0,
                averageWordConfidence: words?.length > 0 ? 
                    words.reduce((sum, w) => sum + w.confidence, 0) / words.length : 0,
                imageType: options.imageType || 'unknown',
                isCroppedImage: !!options.isCroppedImage,
                detectionId: options.detectionId
            },
            detailedResults: {
                words: words?.map(w => ({
                    text: w.text,
                    confidence: w.confidence,
                    bbox: w.bbox
                })) || [],
                lines: lines?.map(l => ({
                    text: l.text,
                    confidence: l.confidence,
                    bbox: l.bbox
                })) || []
            }
        };
    } catch (error) {
        const processingTime = Date.now() - startTime;
        console.error('Tesseract OCR Error:', error);
        if (worker) {
            try {
                await worker.terminate();
            } catch (_) {}
        }
        return {
            success: false,
            error: error.message,
            processingTimeMs: processingTime,
            metadata: {
                imageType: options.imageType || 'unknown',
                isCroppedImage: !!options.isCroppedImage,
                detectionId: options.detectionId
            }
        };
    }
}

/**
 * Batch OCR processing for multiple cropped images
 * Optimized for processing multiple receipt regions from detection results
 */
async function performBatchTesseractOCR(imageBuffers, options = {}) {
    const startTime = Date.now();
    const results = [];
    
    console.log(`Starting batch OCR processing for ${imageBuffers.length} images...`);
    
    // Process in parallel with controlled concurrency to avoid memory issues
    const concurrency = options.concurrency || 3;
    const batches = [];
    
    for (let i = 0; i < imageBuffers.length; i += concurrency) {
        const batch = imageBuffers.slice(i, i + concurrency);
        batches.push(batch);
    }
    
    let processedCount = 0;
    
    for (const batch of batches) {
        const batchPromises = batch.map(async (bufferInfo, batchIndex) => {
            const globalIndex = processedCount + batchIndex;
            
            try {
                const buffer = bufferInfo.buffer || bufferInfo;
                const imageOptions = {
                    ...options,
                    imageType: 'cropped_receipt',
                    isCroppedImage: true,
                    detectionId: bufferInfo.detectionId || `batch_${globalIndex}`,
                    batchIndex: globalIndex
                };
                
                const result = await performTesseractOCR(buffer, imageOptions);
                
                return {
                    index: globalIndex,
                    detectionId: imageOptions.detectionId,
                    ...result
                };
                
            } catch (error) {
                console.error(`Batch OCR error for image ${globalIndex}:`, error.message);
                return {
                    index: globalIndex,
                    detectionId: bufferInfo.detectionId || `batch_${globalIndex}`,
                    success: false,
                    error: error.message
                };
            }
        });
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        processedCount += batch.length;
        
        console.log(`Batch OCR progress: ${processedCount}/${imageBuffers.length} processed`);
    }
    
    const totalProcessingTime = Date.now() - startTime;
    const successfulResults = results.filter(r => r.success);
    
    console.log(`Batch OCR completed: ${successfulResults.length}/${imageBuffers.length} successful in ${totalProcessingTime}ms`);
    
    return {
        success: true,
        results: results,
        summary: {
            totalImages: imageBuffers.length,
            successfulProcessing: successfulResults.length,
            failedProcessing: imageBuffers.length - successfulResults.length,
            totalProcessingTimeMs: totalProcessingTime,
            averageProcessingTimeMs: totalProcessingTime / imageBuffers.length,
            averageConfidence: successfulResults.length > 0 ? 
                successfulResults.reduce((sum, r) => sum + (r.confidence || 0), 0) / successfulResults.length : 0
        }
    };
}

/**
 * Build OCR optimization parameters based on image characteristics
 */
function buildOCROptions(options = {}) {
    const ocrConfig = {
        parameters: {}
    };
    
    // Optimize for cropped receipt images
    if (options.isCroppedImage) {
        // Better for receipt-like documents with structured layout
        ocrConfig.parameters = {
            'tessedit_pageseg_mode': '6', // Uniform block of text
            'tessedit_ocr_engine_mode': '1', // LSTM only
            'tessedit_char_whitelist': '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .,()-/:$€£¥', // Common receipt characters
            'preserve_interword_spaces': '1'
        };
    } else {
        // Default parameters for full document images
        ocrConfig.parameters = {
            'tessedit_pageseg_mode': '3', // Fully automatic page segmentation
            'tessedit_ocr_engine_mode': '1', // LSTM only
            'preserve_interword_spaces': '1'
        };
    }
    
    // Additional optimizations based on image type
    if (options.imageType === 'receipt' || options.imageType === 'invoice') {
        ocrConfig.parameters['tessedit_do_invert'] = '0'; // Don't invert (receipts usually have dark text on light background)
        ocrConfig.parameters['textord_noise_normratio'] = '0.5'; // Reduce noise sensitivity for printed receipts
    }
    
    return ocrConfig;
}

/**
 * Enhanced OCR result classification for cropped images
 * Provides better hints about document type based on OCR content
 */
function classifyOCRContent(ocrResult) {
    if (!ocrResult.success || !ocrResult.rawText) {
        return {
            documentType: 'unknown',
            confidence: 0,
            keywords: []
        };
    }
    
    const text = ocrResult.rawText.toLowerCase();
    const words = text.split(/\s+/);
    
    // Receipt indicators
    const receiptKeywords = ['receipt', 'total', 'subtotal', 'tax', 'change', 'cash', 'card', 'thank you', 'store', 'date', 'time'];
    const receiptMatches = receiptKeywords.filter(keyword => text.includes(keyword));
    
    // Invoice indicators  
    const invoiceKeywords = ['invoice', 'bill to', 'ship to', 'due date', 'amount due', 'payment terms', 'po number', 'invoice number'];
    const invoiceMatches = invoiceKeywords.filter(keyword => text.includes(keyword));
    
    // Determine document type
    let documentType = 'other';
    let confidence = 0;
    let matchedKeywords = [];
    
    if (receiptMatches.length > invoiceMatches.length) {
        documentType = 'receipt';
        confidence = Math.min(receiptMatches.length / receiptKeywords.length, 1.0);
        matchedKeywords = receiptMatches;
    } else if (invoiceMatches.length > 0) {
        documentType = 'invoice';
        confidence = Math.min(invoiceMatches.length / invoiceKeywords.length, 1.0);
        matchedKeywords = invoiceMatches;
    }
    
    // Boost confidence based on OCR quality
    if (ocrResult.confidence) {
        confidence = confidence * 0.7 + (ocrResult.confidence / 100) * 0.3;
    }
    
    return {
        documentType,
        confidence: Math.round(confidence * 100) / 100,
        keywords: matchedKeywords,
        textLength: text.length,
        wordCount: words.length
    };
}

export {
    performTesseractOCR,
    performBatchTesseractOCR,
    classifyOCRContent,
    buildOCROptions
};