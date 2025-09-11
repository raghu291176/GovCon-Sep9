const pdfParse = require('pdf-parse');

async function extractPdfText(buffer) {
  const data = await pdfParse(buffer);
  const pages = data?.numpages || 0;
  const text = String(data?.text || '');
  return { text, pages };
}

module.exports = { extractPdfText };

