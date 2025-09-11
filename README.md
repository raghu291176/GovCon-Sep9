# FAR Compliance Audit System

Single-process Node app that serves both the API and the static frontend, now enhanced with advanced document processing capabilities using Codex OCR workflow. Cleaned for Azure Web App deployment (no containers).

## Quick Start

1) Ensure Node.js 18+ is installed
2) Install deps and start the app:

```
npm install
npm start
```

The app listens on http://localhost:3000 by default. Set `PORT` to override.

## What’s served

- `index.html` (entry file)
- `app.js` (ES module orchestrator)
- `modules/**` (feature modules)
- `style.css` (styles)

## Configuration

- The app reads configuration strictly from environment variables; the Settings tab has been removed.
- LLM (Azure OpenAI) is configured via env (see "Backend" → App settings).
- Azure Document Intelligence is configured via env (`AZURE_DI_ENDPOINT`, `AZURE_DI_KEY`).

Important usage note

- You must import GL entries before uploading supporting documents (receipts/invoices/attachments). The UI disables document upload until at least one GL entry exists, and the backend rejects document ingestion without prior GL import.

## Microsoft 365 (OneDrive/SharePoint) Integration

You can sign in with Microsoft and open Excel workbooks directly from your OneDrive/SharePoint.

Configure MSAL:

- Update `config/msal.json` with your Azure AD App values:
  - `clientId`: Your application (client) ID
  - `authority`: `https://login.microsoftonline.com/<tenantId>` or `.../common`
  - `redirectUri`: Optional; defaults to the site origin
- Required API permissions (delegated): `Files.Read`, `User.Read`, plus `offline_access`, `openid`, `profile`.

Usage:
- Upload tab → “Microsoft 365 (OneDrive/SharePoint)”
- Click “Sign in with Microsoft” and then “Search” or “List Recent”
- Click a workbook row to open; the app auto-detects headers and mapping. If uncertain, a mapping preview UI is shown to confirm columns.

## Alternate Local Hosting

Not required. The backend serves the static frontend directly.

## Backend

The API runs in-memory by default; optional SQLite persistence is supported when available. The backend serves the static frontend from the repo root.

Endpoints used by the app:
- `POST /api/gl` and `GET /api/gl` — in-memory GL entries
- `GET /api/config` — app config (read-only)
- `GET /api/llm-config`, `POST /api/llm-review`, `POST /api/llm-map` — LLM features (require API key if used)
- `GET /api/di-config`, `POST /api/docs/ingest`, `GET /api/docs/items`, `POST/DELETE /api/docs/link` — Document Intelligence + attachments
- `GET /api/requirements` — per-line receipt/approval requirements + attachment counts

Notes:
- Config is environment-only; no runtime settings persistence.
- LLM routes use Azure OpenAI by default (provider fixed to Azure).
- Azure Document Intelligence (optional): set `AZURE_DI_ENDPOINT` and `AZURE_DI_KEY`.

## Codex Document Processing

New advanced document processing workflow available at `/api/document-processing/`:

### Features
- Multi-stage OCR processing with intelligent routing
- Support for receipts, invoices, and general documents
- Fuzzy string matching for vendor/merchant names
- Date and amount tolerance matching
- Confidence scoring and discrepancy identification
- Batch processing capabilities

### Supported OCR Engines
1. **Tesseract OCR** - Initial text extraction and document classification
2. **Azure Form Recognizer** - Specialized processing for receipts and invoices  
3. **Mistral OCR** - Fallback advanced OCR processing

### API Endpoints
- `POST /api/document-processing/process-document` - Process single document
- `POST /api/document-processing/process-batch` - Batch process multiple documents
- `GET /api/document-processing/health` - Health check
- `GET /api/document-processing/supported-formats` - Get supported file formats

### Environment Variables
```bash
# Azure Form Recognizer (Optional but recommended)
AZURE_FORM_RECOGNIZER_ENDPOINT=https://your-resource.cognitiveservices.azure.com/
AZURE_FORM_RECOGNIZER_KEY=your-azure-key

# Mistral OCR (Optional)
MISTRAL_OCR_ENDPOINT=https://api.mistral.ai/v1/ocr
MISTRAL_API_KEY=your-mistral-key
```

### Supported File Formats
- Images: JPEG, PNG, TIFF, BMP
- Documents: PDF
- Maximum file size: 10MB
- Maximum batch size: 10 files

Enable SQLite persistence (optional)

```
npm install better-sqlite3@11.0.0 --prefix backend
```

On startup, the API will create and use `backend/data.sqlite`.

## Receipt/Approval Policy

Defaults:
- Low-dollar waiver: enabled at $25
- Travel/Meals receipt threshold: $75
- Supplies: $0

The server computes requirements per GL line and flags items missing receipts/approvals. The Documents tab surfaces unmatched items and supports quick linking to parsed document items.

## Deploy

### Azure Web App (deploy via VS Code or Portal)

Deploy the folder directly using the VS Code Azure App Service extension (recommended) or Azure Portal’s “Deploy from local Git/Zip” workflows. No Docker or custom scripts required.

Minimal steps (VS Code):

1) Open the folder on your deployment machine in VS Code
2) Install the “Azure App Service” extension
3) Create or select an App Service (Linux, Node 18+)
4) Right-click the folder in VS Code → “Deploy to Web App…” and select your app
5) After deploy, Azure runs `npm install`; `postinstall` installs backend deps; `npm start` runs `node backend/server.js`

App settings (optional):
- `AZURE_OPENAI_ENDPOINT` (e.g., `https://<resource>.openai.azure.com`)
- `AZURE_OPENAI_DEPLOYMENT` (e.g., your model deployment name)
- `AZURE_OPENAI_API_VERSION` (default `2024-06-01`)
- `OPENAI_API_KEY` (Azure OpenAI API key)
- `AZURE_DI_ENDPOINT`, `AZURE_DI_KEY` (optional)
- `SQLITE_PATH=/home/data/govcon.sqlite` (optional; omit for in-memory)

### Local development

Run the single process locally:

```
npm install
PORT=3000 npm start
```

## Removed Legacy Clients

Older experimental clients (Vite React under `frontend/` and Next.js under `web/`) have been removed as unused to simplify the codebase. The current app is the static ES‑modules UI you see at the repo root.

## Reduce Repository Size

Avoid committing large artifacts. Install-time dependencies live under `backend/node_modules/` and are restored by Azure on deploy.
