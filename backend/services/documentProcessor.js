import { FormRecognizerClient, AzureKeyCredential } from '@azure/ai-form-recognizer';
import axios from 'axios';

let client;
if (process.env.AZURE_FORM_RECOGNIZER_ENDPOINT && process.env.AZURE_FORM_RECOGNIZER_KEY) {
    client = new FormRecognizerClient(
        process.env.AZURE_FORM_RECOGNIZER_ENDPOINT,
        new AzureKeyCredential(process.env.AZURE_FORM_RECOGNIZER_KEY)
    );
}

async function processDocument(imageBuffer, tesseractText) {
    const extractedText = tesseractText.toLowerCase();
    
    if (extractedText.includes('receipt')) {
        return await processWithAzureReceipt(imageBuffer);
    } else if (extractedText.includes('invoice')) {
        return await processWithAzureInvoice(imageBuffer);
    } else {
        return await processWithMistralOCR(imageBuffer);
    }
}

async function processWithAzureReceipt(imageBuffer) {
    if (!client) {
        return {
            method: 'azure_receipt',
            success: false,
            error: 'Azure Form Recognizer not configured'
        };
    }
    
    try {
        const poller = await client.beginAnalyzeDocument(
            "prebuilt-receipt", 
            imageBuffer
        );
        
        const result = await poller.pollUntilDone();
        return {
            method: 'azure_receipt',
            success: true,
            data: await extractReceiptData(result)
        };
    } catch (error) {
        console.error('Azure Receipt Processing Error:', error);
        return {
            method: 'azure_receipt',
            success: false,
            error: error.message
        };
    }
}

async function processWithAzureInvoice(imageBuffer) {
    if (!client) {
        return {
            method: 'azure_invoice',
            success: false,
            error: 'Azure Form Recognizer not configured'
        };
    }
    
    try {
        const poller = await client.beginAnalyzeDocument(
            "prebuilt-invoice", 
            imageBuffer
        );
        
        const result = await poller.pollUntilDone();
        return {
            method: 'azure_invoice',
            success: true,
            data: await extractInvoiceData(result)
        };
    } catch (error) {
        console.error('Azure Invoice Processing Error:', error);
        return {
            method: 'azure_invoice',
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

async function extractReceiptData(azureResult) {
    const { extractAmount, extractDate, extractMerchant } = await import('./dataExtraction.js');
    
    if (!azureResult.documents || azureResult.documents.length === 0) {
        return {
            amount: { value: null, confidence: 0 },
            date: { value: null, confidence: 0 },
            merchant: { value: null, confidence: 0 }
        };
    }
    
    const receipt = azureResult.documents[0];
    const fields = receipt.fields || {};
    
    return {
        amount: extractAmount(fields),
        date: extractDate(fields),
        merchant: extractMerchant(fields),
        confidence: calculateConfidence(fields)
    };
}

async function extractInvoiceData(azureResult) {
    const { extractAmount, extractDate, extractVendor } = await import('./dataExtraction.js');
    
    if (!azureResult.documents || azureResult.documents.length === 0) {
        return {
            amount: { value: null, confidence: 0 },
            date: { value: null, confidence: 0 },
            merchant: { value: null, confidence: 0 }
        };
    }
    
    const invoice = azureResult.documents[0];
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
    processWithAzureReceipt,
    processWithAzureInvoice,
    processWithMistralOCR
};