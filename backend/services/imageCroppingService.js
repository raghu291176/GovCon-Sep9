import sharp from 'sharp';
import { fromPath } from 'pdf2pic';

/**
 * Image Cropping Service
 * 
 * This service handles high-performance image cropping operations using Sharp.js
 * and PDF to image conversion using pdf2pic. It processes bounding boxes from 
 * Azure Vision to extract individual receipt regions from source images.
 * 
 * Integration Flow:
 * 1. Receives source image buffer and detection bounding boxes
 * 2. Crops each detected receipt region into separate image buffers
 * 3. Optimizes image quality for OCR processing
 * 4. Returns cropped images ready for classification and extraction pipeline
 */

class ImageCroppingService {
    constructor() {
        this.config = {
            // Output format optimization for OCR
            outputFormat: 'png', // PNG provides best quality for OCR
            outputQuality: 95,
            
            // Image enhancement for OCR
            enhance: {
                sharpen: true,
                normalize: true,
                removeNoise: true
            },
            
            // Padding around detected regions (in pixels)
            cropPadding: {
                horizontal: 10,
                vertical: 10
            },
            
            // Minimum output dimensions
            minOutputWidth: 200,
            minOutputHeight: 200,
            
            // Maximum output dimensions (for memory management)
            maxOutputWidth: 2000,
            maxOutputHeight: 3000,

            // PDF conversion settings
            pdf: {
                density: 200, // DPI for PDF to image conversion
                saveFilename: "page",
                savePath: "./temp/",
                format: "png",
                width: 2000,
                height: 2800
            }
        };
    }

    /**
     * Main cropping function that handles both direct images and PDF conversion
     * 
     * @param {Buffer} sourceBuffer - Source image or PDF buffer
     * @param {Array} detections - Array of detection objects with bounding boxes
     * @param {Object} options - Additional processing options
     * @returns {Promise<Object>} Results with cropped image buffers
     */
    async cropDetectedReceipts(sourceBuffer, detections = [], options = {}) {
        const startTime = Date.now();
        
        try {
            console.log(`Starting image cropping for ${detections.length} detections`);

            // Handle PDF input by converting to images first
            if (this.isPDFBuffer(sourceBuffer)) {
                return await this.cropFromPDF(sourceBuffer, detections, options);
            }

            // Handle direct image input
            return await this.cropFromImage(sourceBuffer, detections, options);

        } catch (error) {
            const processingTime = Date.now() - startTime;
            console.error('Image cropping failed:', error.message);
            
            return {
                success: false,
                error: error.message,
                cropped_images: [],
                processing_time_ms: processingTime,
                metadata: {
                    source_type: this.detectSourceType(sourceBuffer),
                    detections_attempted: detections.length,
                    error_stage: 'cropping'
                }
            };
        }
    }

    /**
     * Crop receipts from a direct image buffer
     * 
     * @param {Buffer} imageBuffer - Source image buffer
     * @param {Array} detections - Detection bounding boxes
     * @param {Object} options - Processing options
     * @returns {Promise<Object>} Cropping results
     */
    async cropFromImage(imageBuffer, detections, options = {}) {
        const startTime = Date.now();
        const croppedImages = [];

        try {
            // Get source image metadata
            const sourceImage = sharp(imageBuffer);
            const metadata = await sourceImage.metadata();
            
            console.log(`Source image: ${metadata.width}x${metadata.height}, format: ${metadata.format}`);

            // Process each detection
            for (let i = 0; i < detections.length; i++) {
                const detection = detections[i];
                
                try {
                    const croppedResult = await this.cropSingleRegion(
                        imageBuffer, 
                        detection, 
                        metadata, 
                        { ...options, detection_index: i }
                    );
                    
                    if (croppedResult.success) {
                        croppedImages.push(croppedResult);
                        console.log(`Successfully cropped detection ${i + 1}/${detections.length}`);
                    } else {
                        console.warn(`Failed to crop detection ${i + 1}: ${croppedResult.error}`);
                    }
                } catch (error) {
                    console.error(`Error cropping detection ${i + 1}:`, error.message);
                }
            }

            const processingTime = Date.now() - startTime;

            return {
                success: true,
                cropped_images: croppedImages,
                processing_time_ms: processingTime,
                metadata: {
                    source_type: 'image',
                    source_dimensions: { width: metadata.width, height: metadata.height },
                    source_format: metadata.format,
                    detections_processed: detections.length,
                    successful_crops: croppedImages.length,
                    failed_crops: detections.length - croppedImages.length
                }
            };

        } catch (error) {
            throw new Error(`Image cropping failed: ${error.message}`);
        }
    }

    /**
     * Handle PDF input by converting pages to images first, then cropping
     * 
     * @param {Buffer} pdfBuffer - Source PDF buffer
     * @param {Array} detections - Detection bounding boxes (assumed for first page)
     * @param {Object} options - Processing options
     * @returns {Promise<Object>} Cropping results
     */
    async cropFromPDF(pdfBuffer, detections, options = {}) {
        const startTime = Date.now();
        
        try {
            console.log('Converting PDF to images for cropping...');
            
            // Convert PDF to images (focusing on first page for now)
            const pdfImages = await this.convertPDFToImages(pdfBuffer, { pageLimit: 1 });
            
            if (pdfImages.length === 0) {
                throw new Error('Failed to convert PDF to images');
            }

            // Use the first page image for cropping
            const pageImageBuffer = pdfImages[0].buffer;
            
            // Crop from the converted page image
            const cropResult = await this.cropFromImage(pageImageBuffer, detections, {
                ...options,
                source_page: 1,
                total_pages: pdfImages.length
            });

            // Update metadata to reflect PDF source
            if (cropResult.metadata) {
                cropResult.metadata.source_type = 'pdf';
                cropResult.metadata.pdf_pages_processed = 1;
            }

            return cropResult;

        } catch (error) {
            const processingTime = Date.now() - startTime;
            throw new Error(`PDF cropping failed: ${error.message}`);
        }
    }

    /**
     * Crop a single receipt region from source image
     * 
     * @param {Buffer} sourceBuffer - Source image buffer
     * @param {Object} detection - Single detection with bounding box
     * @param {Object} sourceMetadata - Source image metadata
     * @param {Object} options - Processing options
     * @returns {Promise<Object>} Single crop result
     */
    async cropSingleRegion(sourceBuffer, detection, sourceMetadata, options = {}) {
        try {
            const bbox = detection.bounding_box || detection.crop_coordinates;
            if (!bbox) {
                return {
                    success: false,
                    error: 'No bounding box provided',
                    detection_id: detection.detection_metadata?.detection_id
                };
            }

            // Apply padding and validate coordinates
            const cropRegion = this.calculateCropRegion(bbox, sourceMetadata);
            
            // Perform the actual cropping with Sharp
            let croppedImage = sharp(sourceBuffer)
                .extract({
                    left: cropRegion.left,
                    top: cropRegion.top,
                    width: cropRegion.width,
                    height: cropRegion.height
                });

            // Apply image enhancements for better OCR
            if (this.config.enhance.sharpen) {
                croppedImage = croppedImage.sharpen();
            }
            
            if (this.config.enhance.normalize) {
                croppedImage = croppedImage.normalize();
            }

            // Ensure minimum dimensions for OCR quality
            const cropMetadata = await croppedImage.metadata();
            if (cropMetadata.width < this.config.minOutputWidth || 
                cropMetadata.height < this.config.minOutputHeight) {
                
                const resizeWidth = Math.max(cropMetadata.width, this.config.minOutputWidth);
                const resizeHeight = Math.max(cropMetadata.height, this.config.minOutputHeight);
                
                croppedImage = croppedImage.resize(resizeWidth, resizeHeight, {
                    fit: 'contain',
                    background: { r: 255, g: 255, b: 255, alpha: 1 } // White background
                });
            }

            // Convert to buffer with optimized settings
            const outputBuffer = await croppedImage
                .png({ quality: this.config.outputQuality, compressionLevel: 6 })
                .toBuffer();

            const finalMetadata = await sharp(outputBuffer).metadata();

            return {
                success: true,
                buffer: outputBuffer,
                format: 'png',
                dimensions: {
                    width: finalMetadata.width,
                    height: finalMetadata.height
                },
                detection_info: {
                    detection_id: detection.detection_metadata?.detection_id,
                    confidence: detection.confidence,
                    original_bbox: bbox,
                    final_crop_region: cropRegion,
                    object_name: detection.object_name
                },
                processing_info: {
                    enhancements_applied: this.config.enhance,
                    detection_index: options.detection_index,
                    source_page: options.source_page
                }
            };

        } catch (error) {
            return {
                success: false,
                error: error.message,
                detection_id: detection.detection_metadata?.detection_id
            };
        }
    }

    /**
     * Calculate optimal crop region with padding and boundary checks
     * 
     * @param {Object} bbox - Original bounding box
     * @param {Object} sourceMetadata - Source image metadata
     * @returns {Object} Validated crop region coordinates
     */
    calculateCropRegion(bbox, sourceMetadata) {
        const padding = this.config.cropPadding;
        
        // Calculate crop region with padding
        let left = Math.max(0, bbox.x - padding.horizontal);
        let top = Math.max(0, bbox.y - padding.vertical);
        let right = Math.min(sourceMetadata.width, bbox.x + bbox.width + padding.horizontal);
        let bottom = Math.min(sourceMetadata.height, bbox.y + bbox.height + padding.vertical);
        
        // Ensure minimum dimensions
        const width = right - left;
        const height = bottom - top;
        
        if (width < this.config.minOutputWidth) {
            const expand = (this.config.minOutputWidth - width) / 2;
            left = Math.max(0, left - expand);
            right = Math.min(sourceMetadata.width, right + expand);
        }
        
        if (height < this.config.minOutputHeight) {
            const expand = (this.config.minOutputHeight - height) / 2;
            top = Math.max(0, top - expand);
            bottom = Math.min(sourceMetadata.height, bottom + expand);
        }

        return {
            left: Math.round(left),
            top: Math.round(top),
            width: Math.round(right - left),
            height: Math.round(bottom - top)
        };
    }

    /**
     * Convert PDF buffer to image buffers for processing
     * 
     * @param {Buffer} pdfBuffer - Source PDF buffer
     * @param {Object} options - Conversion options
     * @returns {Promise<Array>} Array of image buffers
     */
    async convertPDFToImages(pdfBuffer, options = {}) {
        const pageLimit = options.pageLimit || 5; // Process max 5 pages
        
        try {
            // Write PDF buffer to temporary file for pdf2pic
            const tempPdfPath = `/tmp/temp_pdf_${Date.now()}.pdf`;
            const fs = await import('fs');
            fs.writeFileSync(tempPdfPath, pdfBuffer);

            // Convert PDF to images
            const convert = fromPath(tempPdfPath, {
                density: this.config.pdf.density,
                saveFilename: this.config.pdf.saveFilename,
                savePath: this.config.pdf.savePath,
                format: this.config.pdf.format,
                width: this.config.pdf.width,
                height: this.config.pdf.height
            });

            const results = [];
            const pagesToProcess = Math.min(pageLimit, 1); // For now, just process first page

            for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
                try {
                    const result = await convert(pageNum);
                    
                    if (result && result.path) {
                        // Read the converted image file
                        const imageBuffer = fs.readFileSync(result.path);
                        
                        results.push({
                            page: pageNum,
                            buffer: imageBuffer,
                            path: result.path,
                            name: result.name
                        });

                        // Clean up temporary image file
                        try {
                            fs.unlinkSync(result.path);
                        } catch (cleanupError) {
                            console.warn(`Failed to clean up temp file: ${result.path}`);
                        }
                    }
                } catch (pageError) {
                    console.error(`Failed to convert PDF page ${pageNum}:`, pageError.message);
                }
            }

            // Clean up temporary PDF file
            try {
                fs.unlinkSync(tempPdfPath);
            } catch (cleanupError) {
                console.warn(`Failed to clean up temp PDF file: ${tempPdfPath}`);
            }

            console.log(`Successfully converted ${results.length} pages from PDF`);
            return results;

        } catch (error) {
            throw new Error(`PDF conversion failed: ${error.message}`);
        }
    }

    /**
     * Detect if buffer contains PDF data
     * 
     * @param {Buffer} buffer - Buffer to analyze
     * @returns {boolean} True if buffer appears to be PDF
     */
    isPDFBuffer(buffer) {
        if (!buffer || buffer.length < 4) return false;
        
        // Check for PDF magic bytes
        const pdfHeader = buffer.slice(0, 4).toString('ascii');
        return pdfHeader === '%PDF';
    }

    /**
     * Detect source type for debugging
     * 
     * @param {Buffer} buffer - Source buffer
     * @returns {string} Detected source type
     */
    detectSourceType(buffer) {
        if (!buffer) return 'unknown';
        
        if (this.isPDFBuffer(buffer)) return 'pdf';
        
        // Check for common image formats
        const header = buffer.slice(0, 8);
        if (header[0] === 0xFF && header[1] === 0xD8) return 'jpeg';
        if (header[0] === 0x89 && header[1] === 0x50) return 'png';
        if (header[0] === 0x47 && header[1] === 0x49) return 'gif';
        if (header[0] === 0x42 && header[1] === 0x4D) return 'bmp';
        
        return 'unknown';
    }

    /**
     * Get current configuration for debugging
     * 
     * @returns {Object} Current service configuration
     */
    getConfiguration() {
        return {
            outputFormat: this.config.outputFormat,
            outputQuality: this.config.outputQuality,
            enhancements: this.config.enhance,
            padding: this.config.cropPadding,
            minDimensions: {
                width: this.config.minOutputWidth,
                height: this.config.minOutputHeight
            },
            maxDimensions: {
                width: this.config.maxOutputWidth,
                height: this.config.maxOutputHeight
            }
        };
    }
}

// Export singleton instance for use across the application
const imageCroppingService = new ImageCroppingService();

export {
    imageCroppingService,
    ImageCroppingService
};