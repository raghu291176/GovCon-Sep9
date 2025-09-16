import express from 'express';
import multer from 'multer';
import { processDocumentWorkflow, batchProcessDocuments } from '../services/documentWorkflow.js';
const router = express.Router();

const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { 
        fileSize: 10 * 1024 * 1024,
        files: 10
    },
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = [
            'image/jpeg',
            'image/png',
            'image/tiff',
            'image/bmp',
            'application/pdf'
        ];
        
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
        }
    }
});

async function getGLEntries(req) {
    return [
        {
            id: 'GL-001',
            amount: 123.45,
            date: '2024-03-15',
            vendor: 'ABC Store',
            description: 'Office supplies',
            account: '6000-Office Expenses'
        },
        {
            id: 'GL-002',
            amount: 456.78,
            date: '2024-03-16',
            vendor: 'Tech Solutions Inc',
            description: 'Software license',
            account: '6100-Software'
        },
        {
            id: 'GL-003',
            amount: 89.99,
            date: '2024-03-17',
            vendor: 'Restaurant Supply Co',
            description: 'Business meal',
            account: '6200-Meals & Entertainment'
        }
    ];
}

router.post('/process-document', upload.single('document'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ 
                success: false,
                error: 'No file uploaded',
                code: 'NO_FILE'
            });
        }
        
        const glEntries = await getGLEntries(req);
        
        const options = {
            maxDateDiff: parseInt(req.body.maxDateDiff) || 14,
            maxAmountDiff: parseFloat(req.body.maxAmountDiff) || 50.00,
            minScore: parseInt(req.body.minScore) || 50,
            maxResults: parseInt(req.body.maxResults) || 10
        };
        
        const result = await processDocumentWorkflow(
            req.file.buffer,
            glEntries,
            { ...options, fileType: req.file.mimetype, filename: req.file.originalname }
        );
        
        res.json({
            success: true,
            data: result
        });
        
    } catch (error) {
        console.error('Document processing error:', error);
        
        if (error.message.includes('Unsupported file type')) {
            return res.status(400).json({ 
                success: false,
                error: 'Unsupported file type',
                code: 'INVALID_FILE_TYPE',
                details: error.message 
            });
        }
        
        res.status(500).json({ 
            success: false,
            error: 'Processing failed', 
            code: 'PROCESSING_ERROR',
            details: error.message 
        });
    }
});

router.post('/process-batch', upload.array('documents', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ 
                success: false,
                error: 'No files uploaded',
                code: 'NO_FILES'
            });
        }
        
        const glEntries = await getGLEntries(req);
        
        const options = {
            maxDateDiff: parseInt(req.body.maxDateDiff) || 14,
            maxAmountDiff: parseFloat(req.body.maxAmountDiff) || 50.00,
            minScore: parseInt(req.body.minScore) || 50,
            maxResults: parseInt(req.body.maxResults) || 10
        };
        
        const documents = req.files.map(file => ({
            name: file.originalname,
            buffer: file.buffer,
            mimetype: file.mimetype,
            size: file.size
        }));
        
        const result = await batchProcessDocuments(documents, glEntries, options);
        
        res.json({
            success: true,
            data: result
        });
        
    } catch (error) {
        console.error('Batch processing error:', error);
        
        res.status(500).json({ 
            success: false,
            error: 'Batch processing failed', 
            code: 'BATCH_PROCESSING_ERROR',
            details: error.message 
        });
    }
});

router.get('/health', async (req, res) => {
    try {
        // Helper to parse api-version from a URL
        const parseApiVersion = (url) => {
            try {
                const u = new URL(url);
                return u.searchParams.get('api-version') || null;
            } catch {
                return null;
            }
        };

        const healthCheck = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            services: {
                tesseract: 'available',
                azure_openai: {
                    endpoint: process.env.AZURE_OPENAI_ENDPOINT ? 'configured' : 'not_configured',
                    key: process.env.OPENAI_API_KEY ? 'configured' : 'not_configured',
                    deployment: process.env.AZURE_OPENAI_DEPLOYMENT ? 'configured' : 'not_configured',
                    api_version: process.env.AZURE_OPENAI_API_VERSION || 'unset'
                },
                mistral_ocr: {
                    endpoint: process.env.AZURE_FOUNDRY_MISTRAL_ENDPOINT ? 'configured' : 'not_configured',
                    key: process.env.AZURE_FOUNDRY_MISTRAL_KEY ? 'configured' : 'not_configured',
                    model: process.env.AZURE_FOUNDRY_MISTRAL_MODEL ? 'configured' : 'not_configured',
                    api_version: parseApiVersion(process.env.AZURE_FOUNDRY_MISTRAL_ENDPOINT || '') || 'unset'
                }
            },
            version: '1.0.0'
        };

        res.json(healthCheck);
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message
        });
    }
});

router.get('/supported-formats', (req, res) => {
    res.json({
        success: true,
        data: {
            image_formats: ['jpeg', 'jpg', 'png', 'tiff', 'bmp'],
            document_formats: ['pdf'],
            max_file_size: '10MB',
            max_batch_size: 10,
            processing_methods: [
                {
                    name: 'tesseract',
                    description: 'Basic OCR processing for all document types',
                    always_available: true
                },
                {
                    name: 'mistral_ocr',
                    description: 'Advanced OCR processing with Mistral',
                    requires_configuration: 'AZURE_FOUNDRY_MISTRAL_ENDPOINT'
                }
            ]
        }
    });
});

router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'File too large',
                code: 'FILE_TOO_LARGE',
                details: 'Maximum file size is 10MB'
            });
        }
        
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                success: false,
                error: 'Too many files',
                code: 'TOO_MANY_FILES',
                details: 'Maximum 10 files per batch'
            });
        }
    }
    
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
    });
});

export default router;
