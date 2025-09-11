import Tesseract from 'tesseract.js';

async function performTesseractOCR(imageBuffer) {
    try {
        const { data: { text } } = await Tesseract.recognize(
            imageBuffer,
            'eng',
            {
                logger: m => console.log(`Tesseract: ${m.status} - ${m.progress}`)
            }
        );
        
        return {
            success: true,
            extractedText: text.toLowerCase(),
            rawText: text
        };
    } catch (error) {
        console.error('Tesseract OCR Error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

export {
    performTesseractOCR
};