# doc-router-next

Next.js API that accepts a single document upload and routes it to Azure Document Intelligence (Invoice/Receipt/General) or a Mistral OCR endpoint, using a fast server-side skim OCR for images to classify.

All configuration is via Azure App Service environment variables.

## Architecture (ASCII)

```
Client ──multipart/form-data──> /api/route-document (Next API)
   │                                   │
   │                                   ├─ if image: Tesseract OSD → Sharp rotate → short OCR sample
   │                                   ├─ if PDF: pdf-parse (no OCR)
   │                                   └─ classify sample (or hint override)
   │
   └<── JSON (docType, source, orientation, sample, result, meta)

Route mapping:
  invoice        ──> Azure DI prebuilt-invoice
  receipt        ──> Azure DI prebuilt-receipt
  timesheet/approval ─> Azure DI prebuilt-general-document
  orgchart/other ──> Mistral OCR
```

## API

POST `/api/route-document`

- Content-Type: `multipart/form-data`
- Field: `file` (png/jpg/jpeg or application/pdf)
- Optional routing hint: `?hint=invoice|receipt|timesheet|approval|orgchart|other` or header `x-hint` with same values.

Response:

```
{
  "docType": "invoice|receipt|timesheet|approval|orgchart|other",
  "source": "azure-di:invoice|azure-di:receipt|azure-di:general|mistral-ocr",
  "orientation": { "degrees": 0|90|180|270, "applied": true|false },
  "classificationSample": "<first 400 chars used for routing>",
  "result": { ... raw provider response ... },
  "meta": { "mime": "...", "pages": 1, "elapsedMs": 1234 }
}
```

Sample cURL (image upload):

```
curl -X POST \
  -H "x-hint: receipt" \
  -F "file=@/path/to/receipt.jpg" \
  http://localhost:8080/api/route-document | jq
```

Sample cURL (PDF upload, no hint):

```
curl -X POST \
  -F "file=@/path/to/document.pdf" \
  http://localhost:8080/api/route-document | jq
```

Health:

- `GET /api/healthz` → `{ ok: true }`
- `GET /api/readyz` → `{ ok: true }`

## Quick Start

```
npm install
npm run dev
```

Build and run:

```
npm run build
npm start
```

## Azure App Service configuration

Set the following Application Settings (environment variables). No `.env` file is included; for local dev, `export VAR=...` before `npm run dev`.

### Required for Azure Document Intelligence (if using DI)

- `AZURE_DI_ENDPOINT` — e.g., `https://<resource>.cognitiveservices.azure.com`
- `AZURE_DI_API_VERSION` — default `2024-07-31`
- `AZURE_DI_KEY` — subscription key for DI
- `AZURE_DI_INVOICE_MODEL` — default `prebuilt-invoice`
- `AZURE_DI_RECEIPT_MODEL` — default `prebuilt-receipt`
- `AZURE_DI_GENERAL_MODEL` — default `prebuilt-general-document`

### Required for Mistral OCR (if using Mistral)

- `MISTRAL_OCR_ENDPOINT` — HTTP endpoint to POST raw bytes
- `MISTRAL_OCR_API_KEY` — API key (sent as `x-api-key`)

### Server & Security

- `PORT` — default `8080`
- `NODE_ENV` — `production|development` (default `development`)
- `ALLOWED_ORIGINS` — comma-separated list for CORS (exact matches). Empty → cross-origin blocked.
- `MAX_UPLOAD_MB` — integer megabytes (default `10`)

## Notes

- Multer is used for `multipart/form-data` uploads; max size is enforced via `MAX_UPLOAD_MB`.
- Tesseract.js is used for orientation (OSD) and a quick read; we never run full PDF raster OCR. PDFs with embedded text are classified from text; scanned PDFs default to Azure DI General.
- Logs include a request ID and redact filenames; secrets are never logged.
