import nextConnect from 'next-connect';
import multer from 'multer';
const { env } = require('../../lib/env');
const { corsMiddleware } = require('../../lib/cors');
const { reqContextMiddleware } = require('../../lib/logger');
const { autoOrientAndSkimImage } = require('../../lib/ocr/skim');
const { extractPdfText } = require('../../lib/ocr/pdf');
const { classify } = require('../../lib/classify');
const { analyzeWithDI } = require('../../lib/providers/azure-di');
const { callMistralOcr } = require('../../lib/providers/mistral-ocr');

export const config = { api: { bodyParser: false } };

function coerceHint(v) {
  const t = (v || '').toLowerCase();
  switch (t) {
    case 'invoice':
    case 'receipt':
    case 'timesheet':
    case 'approval':
    case 'orgchart':
    case 'other':
      return t;
    default:
      return undefined;
  }
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024 } });

const api = nextConnect({
  onError(err, req, res) {
    const log = req.logger;
    const status = err?.status || 500;
    log?.error('Handler error', { status, msg: String(err?.message || err) });
    res.status(status).json({ error: String(err?.message || 'Internal error') });
  },
  onNoMatch(req, res) {
    res.status(405).json({ error: 'Method not allowed' });
  },
});

api.use(corsMiddleware);
api.use(reqContextMiddleware);
api.use(upload.single('file'));

api.post(async (req, res) => {
  const log = req.logger;
  const started = Date.now();
  const hint = coerceHint(req.query?.hint || req.headers['x-hint']);
  const f = req.file;
  if (!f) return res.status(400).json({ error: 'Missing file field "file".' });
  const mime = f.mimetype || 'application/octet-stream';
  const size = f.size || 0;
  const redactedName = f.originalname ? `***.${(f.originalname.split('.').pop() || 'bin')}` : '(no-name)';
  log.info('Upload received', { mime, size, file: redactedName });

  const isImg = /^image\/(png|jpe?g)$/i.test(mime);
  const isPdf = /^application\/pdf$/i.test(mime);
  if (!isImg && !isPdf) return res.status(400).json({ error: 'Unsupported file type. Use PNG/JPG/JPEG or PDF.' });

  let orientation = { degrees: 0, applied: false };
  let sample = '';
  let pages = 1;
  let routed;
  let result = null;
  let docType;

  if (isImg) {
    const { rotated, degrees, text } = await autoOrientAndSkimImage(f.buffer, mime);
    orientation = { degrees, applied: degrees !== 0 };
    sample = text.slice(0, 400);
    const cls = classify(text);
    docType = hint || cls;
    if (docType === 'invoice') {
      routed = 'azure-di:invoice';
      result = await analyzeWithDI(env.AZURE_DI_INVOICE_MODEL, rotated, mime);
    } else if (docType === 'receipt') {
      routed = 'azure-di:receipt';
      result = await analyzeWithDI(env.AZURE_DI_RECEIPT_MODEL, rotated, mime);
    } else if (docType === 'timesheet' || docType === 'approval') {
      routed = 'azure-di:general';
      result = await analyzeWithDI(env.AZURE_DI_GENERAL_MODEL, rotated, mime);
    } else {
      routed = 'mistral-ocr';
      result = await callMistralOcr(rotated, mime);
    }
  } else if (isPdf) {
    const { text, pages: p } = await extractPdfText(f.buffer);
    pages = p || 1;
    sample = (text || '').slice(0, 400);
    if (text && text.trim().length > 0) {
      const cls = classify(text);
      docType = hint || cls;
      if (docType === 'invoice') {
        routed = 'azure-di:invoice';
        result = await analyzeWithDI(env.AZURE_DI_INVOICE_MODEL, f.buffer, mime);
      } else if (docType === 'receipt') {
        routed = 'azure-di:receipt';
        result = await analyzeWithDI(env.AZURE_DI_RECEIPT_MODEL, f.buffer, mime);
      } else if (docType === 'timesheet' || docType === 'approval') {
        routed = 'azure-di:general';
        result = await analyzeWithDI(env.AZURE_DI_GENERAL_MODEL, f.buffer, mime);
      } else {
        routed = 'mistral-ocr';
        result = await callMistralOcr(f.buffer, mime);
      }
    } else {
      docType = hint || 'other';
      routed = 'azure-di:general';
      result = await analyzeWithDI(env.AZURE_DI_GENERAL_MODEL, f.buffer, mime);
    }
  }

  const elapsedMs = Date.now() - started;
  res.json({
    docType,
    source: routed,
    orientation,
    classificationSample: sample,
    result,
    meta: { mime, pages, elapsedMs },
  });
});

export default api;
