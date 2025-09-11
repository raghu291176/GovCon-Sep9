import { ComputerVisionClient } from '@azure/cognitiveservices-computervision';
import { ApiKeyCredentials } from '@azure/ms-rest-js';

/**
 * Azure AI Vision Service for Receipt Detection
 * 
 * This service uses Azure AI Vision's object detection capabilities to identify
 * and locate receipts within images. It integrates with the latest Azure AI Foundry
 * Vision APIs to detect bounding boxes around receipt objects.
 * 
 * Integration Flow:
 * 1. Input image/PDF page is analyzed for receipt objects
 * 2. Bounding boxes are returned for each detected receipt
 * 3. Each detected receipt area is cropped as a separate image
 * 4. Cropped images are processed through existing OCR pipeline
 */

class AzureVisionService {
    constructor() {
        this.client = null;
        this.config = {
            endpoint: process.env.AZURE_VISION_ENDPOINT,
            key: process.env.AZURE_VISION_KEY,
            apiVersion: process.env.AZURE_VISION_API_VERSION || '2024-02-01',
            confidenceThreshold: parseFloat(process.env.RECEIPT_DETECTION_CONFIDENCE_THRESHOLD) || 0.5,
            minBoxSize: parseInt(process.env.RECEIPT_MIN_BOX_SIZE) || 100,
            maxDetections: parseInt(process.env.MAX_DETECTED_RECEIPTS) || 10
        };
        
        this.initializeClient();
    }

    /**
     * Initialize the Azure Vision client with credentials and configuration
     */
    initializeClient() {
        try {
            if (!this.config.endpoint || !this.config.key) {
                console.warn('Azure Vision not configured - receipt detection will be skipped');
                return;
            }

            // Remove trailing slash and ensure proper endpoint format
            const cleanEndpoint = this.config.endpoint.replace(/\/$/, '');
            
            this.client = new ComputerVisionClient(
                new ApiKeyCredentials({ inHeader: { 'Ocp-Apim-Subscription-Key': this.config.key } }),
                cleanEndpoint
            );
            
            console.log('Azure Vision client initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Azure Vision client:', error.message);
            this.client = null;
        }
    }

    /**
     * Check if the Azure Vision service is properly configured and available
     * @returns {boolean} True if service is available
     */
    isAvailable() {
        return this.client !== null && this.config.endpoint && this.config.key;
    }

    /**
     * Detect receipt objects in an image using Azure AI Vision
     * 
     * @param {Buffer} imageBuffer - The image data as a buffer
     * @param {Object} metadata - Optional metadata about the image
     * @returns {Promise<Object>} Detection results with bounding boxes
     */
    async detectReceiptObjects(imageBuffer, metadata = {}) {
        if (!this.isAvailable()) {
            console.warn('Azure Vision service not available - skipping receipt detection');
            return {
                success: false,
                error: 'Azure Vision service not configured',
                detections: [],
                metadata: { ...metadata, service_available: false }
            };
        }

        const startTime = Date.now();
        
        try {
            console.log('Starting receipt object detection with Azure AI Vision');

            // Configure analysis features for object detection
            const visualFeatures = ['Objects'];
            
            // Perform the analysis using Computer Vision API
            const result = await this.client.analyzeImageInStream(imageBuffer, {
                visualFeatures: visualFeatures,
                language: 'en'
            });
            
            const processingTime = Date.now() - startTime;
            console.log(`Azure Vision analysis completed in ${processingTime}ms`);

            // Process and filter the detected objects for receipts
            const receiptDetections = this.processObjectDetections(result, metadata);
            
            return {
                success: true,
                detections: receiptDetections,
                processing_time_ms: processingTime,
                metadata: {
                    ...metadata,
                    service_available: true,
                    total_objects_detected: result.objects?.length || 0,
                    receipt_objects_detected: receiptDetections.length,
                    image_dimensions: {
                        width: result.metadata?.width,
                        height: result.metadata?.height
                    }
                }
            };

        } catch (error) {
            const processingTime = Date.now() - startTime;
            console.error('Azure Vision receipt detection failed:', error.message);
            
            return {
                success: false,
                error: error.message,
                detections: [],
                processing_time_ms: processingTime,
                metadata: {
                    ...metadata,
                    service_available: true,
                    error_type: this.categorizeError(error)
                }
            };
        }
    }

    /**
     * Process raw object detection results to identify and filter receipt objects
     * 
     * @param {Object} analysisResult - Raw result from Azure Vision API
     * @param {Object} metadata - Image metadata
     * @returns {Array} Array of receipt detection objects with bounding boxes
     */
    processObjectDetections(analysisResult, metadata = {}) {
        const detections = [];
        
        if (!analysisResult.objects) {
            console.log('No objects detected in image');
            return detections;
        }

        const objects = analysisResult.objects;
        console.log(`Processing ${objects.length} detected objects`);

        for (const obj of objects) {
            // Check if object is receipt-related
            if (this.isReceiptObject(obj)) {
                const detection = this.createDetectionObject(obj, analysisResult.metadata, metadata);
                
                // Validate bounding box size and confidence
                if (this.isValidDetection(detection)) {
                    detections.push(detection);
                    console.log(`Valid receipt detection: ${detection.object_name} (confidence: ${detection.confidence.toFixed(2)})`);
                } else {
                    console.log(`Filtered out low-quality detection: ${obj.objectProperty} (confidence: ${obj.confidence.toFixed(2)})`);
                }
            }
        }

        // Sort by confidence and limit results
        detections.sort((a, b) => b.confidence - a.confidence);
        const limitedDetections = detections.slice(0, this.config.maxDetections);
        
        console.log(`Returning ${limitedDetections.length} receipt detections (filtered from ${objects.length} total objects)`);
        return limitedDetections;
    }

    /**
     * Determine if a detected object is likely to be a receipt or invoice
     * 
     * @param {Object} obj - Object detection result from Azure Vision
     * @returns {boolean} True if object appears to be receipt-related
     */
    isReceiptObject(obj) {
        if (!obj.object) return false;

        const objectName = obj.object.toLowerCase();
        const receiptKeywords = [
            'receipt', 'invoice', 'bill', 'ticket', 'voucher',
            'document', 'paper', 'text', 'form', 'record'
        ];

        // Check for direct receipt-related terms
        if (receiptKeywords.some(keyword => objectName.includes(keyword))) {
            return true;
        }

        // Additional heuristics for receipt-like objects
        // Check confidence and bounding box characteristics
        if (obj.confidence >= this.config.confidenceThreshold) {
            const bbox = obj.rectangle;
            if (bbox) {
                const width = bbox.w;
                const height = bbox.h;
                const aspectRatio = height / width;
                
                // Receipts are typically taller than they are wide (aspect ratio > 1)
                // But also accept reasonable horizontal documents
                if (aspectRatio > 0.5 && aspectRatio < 5.0) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Create a standardized detection object from Azure Vision results
     * 
     * @param {Object} obj - Raw object detection from Azure Vision
     * @param {Object} imageMetadata - Metadata about the analyzed image
     * @param {Object} requestMetadata - Additional request metadata
     * @returns {Object} Standardized detection object
     */
    createDetectionObject(obj, imageMetadata, requestMetadata) {
        const bbox = obj.rectangle;
        
        return {
            object_name: obj.object,
            confidence: obj.confidence,
            bounding_box: {
                x: Math.round(bbox.x),
                y: Math.round(bbox.y),
                width: Math.round(bbox.w),
                height: Math.round(bbox.h)
            },
            // Additional computed properties for cropping
            crop_coordinates: {
                left: Math.round(bbox.x),
                top: Math.round(bbox.y),
                width: Math.round(bbox.w),
                height: Math.round(bbox.h)
            },
            detection_metadata: {
                image_width: imageMetadata?.width,
                image_height: imageMetadata?.height,
                detection_id: `det_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                timestamp: new Date().toISOString(),
                ...requestMetadata
            }
        };
    }

    /**
     * Validate a detection based on confidence and size thresholds
     * 
     * @param {Object} detection - Detection object to validate
     * @returns {boolean} True if detection meets quality criteria
     */
    isValidDetection(detection) {
        // Check confidence threshold
        if (detection.confidence < this.config.confidenceThreshold) {
            return false;
        }

        // Check minimum bounding box size
        const bbox = detection.bounding_box;
        if (bbox.width < this.config.minBoxSize || bbox.height < this.config.minBoxSize) {
            return false;
        }

        // Ensure reasonable aspect ratio (not too thin/wide)
        const aspectRatio = bbox.height / bbox.width;
        if (aspectRatio < 0.1 || aspectRatio > 10) {
            return false;
        }

        // Ensure bounding box is within reasonable image bounds
        if (bbox.x < 0 || bbox.y < 0) {
            return false;
        }

        return true;
    }

    /**
     * Categorize error types for better debugging and monitoring
     * 
     * @param {Error} error - The error object
     * @returns {string} Error category
     */
    categorizeError(error) {
        const message = error.message.toLowerCase();
        
        if (message.includes('auth') || message.includes('credential')) {
            return 'authentication';
        } else if (message.includes('quota') || message.includes('rate')) {
            return 'quota_exceeded';
        } else if (message.includes('network') || message.includes('timeout')) {
            return 'network';
        } else if (message.includes('invalid') || message.includes('format')) {
            return 'invalid_input';
        } else {
            return 'unknown';
        }
    }

    /**
     * Get current configuration for debugging and monitoring
     * 
     * @returns {Object} Current service configuration (without sensitive data)
     */
    getConfiguration() {
        return {
            endpoint: this.config.endpoint ? '***configured***' : 'not configured',
            hasKey: !!this.config.key,
            apiVersion: this.config.apiVersion,
            confidenceThreshold: this.config.confidenceThreshold,
            minBoxSize: this.config.minBoxSize,
            maxDetections: this.config.maxDetections,
            isAvailable: this.isAvailable()
        };
    }
}

// Export singleton instance for use across the application
const azureVisionService = new AzureVisionService();

export {
    azureVisionService,
    AzureVisionService
};