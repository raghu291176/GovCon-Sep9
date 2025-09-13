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

Enhanced advanced document processing workflow available at `/api/document-processing/` with new Azure AI Vision integration:

### Enhanced Features
- **🆕 Azure AI Vision Object Detection** - Automatically detects and locates multiple receipts within a single image
- **🆕 Intelligent Image Cropping** - Extracts individual receipt regions using Sharp.js for optimal OCR processing
- **🆕 Multi-Receipt Processing** - Processes multiple receipts found in a single image/PDF page
- **🆕 Enhanced PDF Support** - Converts PDF pages to images before receipt detection and cropping
- Multi-stage OCR processing with intelligent routing
- Support for receipts, invoices, and general documents
- Fuzzy string matching for vendor/merchant names
- Date and amount tolerance matching
- Confidence scoring and discrepancy identification
- Batch processing capabilities

### Processing Flow (Content Understanding)
1. **Classification**: Tesseract OCR analyzes the document to classify as "receipt", "invoice", or "other"
2. **Intelligent Processing**: Documents are routed to appropriate analyzers:
   - **Receipts**: Microsoft Content Understanding receipt analyzer with custom field extraction
   - **Invoices**: Microsoft Content Understanding invoice analyzer with vendor/amount detection
   - **Other**: Azure Foundry Mistral OCR with vision capabilities
3. **Data Extraction**: High-confidence extraction of amount, date, and merchant/vendor information
4. **GL Matching**: Intelligent matching to GL entries with confidence scoring
5. **Automatic Updates**: High-confidence matches automatically update GL entries with document attachments

### Supported OCR Engines
1. **Tesseract OCR** - Initial text extraction and document classification
2. **Microsoft Content Understanding** - Advanced custom analyzers for receipts and invoices with flexible field extraction
3. **Azure Foundry Mistral** - Advanced OCR processing for other document types

### API Endpoints
- `POST /api/document-processing/process-document` - Process single document
- `POST /api/document-processing/process-batch` - Batch process multiple documents
- `GET /api/document-processing/health` - Health check
- `GET /api/document-processing/supported-formats` - Get supported file formats

### Environment Variables
```bash
# Azure AI Document Intelligence (Optional but recommended)
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://your-resource.cognitiveservices.azure.com/
AZURE_DOCUMENT_INTELLIGENCE_KEY=your-azure-key
AZURE_DOCUMENT_INTELLIGENCE_API_VERSION=2024-07-31-preview

# 🆕 Azure AI Vision (For receipt detection - Optional)
AZURE_VISION_ENDPOINT=https://your-vision-resource.cognitiveservices.azure.com/
AZURE_VISION_KEY=your-azure-vision-key  
AZURE_VISION_API_VERSION=2024-02-01

# 🆕 Receipt Detection Configuration
RECEIPT_DETECTION_CONFIDENCE_THRESHOLD=0.5
RECEIPT_MIN_BOX_SIZE=100
MAX_DETECTED_RECEIPTS=10

# Microsoft Content Understanding (Recommended - for receipt/invoice processing)
CONTENT_UNDERSTANDING_ENDPOINT=https://your-content-understanding-resource.cognitiveservices.azure.com
CONTENT_UNDERSTANDING_KEY=your-content-understanding-key
CONTENT_UNDERSTANDING_API_VERSION=2025-05-01-preview
CONTENT_UNDERSTANDING_RECEIPT_ANALYZER_ID=receipt-analyzer
CONTENT_UNDERSTANDING_INVOICE_ANALYZER_ID=invoice-analyzer

# Azure Foundry Mistral OCR (Optional - for documents classified as 'Other')
AZURE_FOUNDRY_MISTRAL_ENDPOINT=https://your-foundry-endpoint.azure.com/v1/chat/completions
AZURE_FOUNDRY_MISTRAL_KEY=your-azure-foundry-key
```

### Configuration Details

#### Azure AI Vision Setup
1. Create an Azure Computer Vision resource in your Azure portal
2. Copy the endpoint URL and subscription key
3. Set the environment variables above
4. The system will automatically detect and crop multiple receipts from single images

#### Receipt Detection Parameters
- `RECEIPT_DETECTION_CONFIDENCE_THRESHOLD`: Minimum confidence (0-1) for receipt detection (default: 0.5)
- `RECEIPT_MIN_BOX_SIZE`: Minimum bounding box size in pixels (default: 100)
- `MAX_DETECTED_RECEIPTS`: Maximum number of receipts to process per image (default: 10)

### Example Usage

**Input**: Single image containing multiple receipts (e.g., a photo of several receipts on a table)

**Enhanced Processing**:
1. Azure AI Vision detects 3 receipt objects with bounding boxes
2. Sharp.js crops each receipt into separate optimized images
3. Each cropped receipt processed through OCR pipeline:
   - Receipt 1: Classified as "receipt" → Azure Document Intelligence → $15.50, Starbucks, 2024-01-15
   - Receipt 2: Classified as "invoice" → Azure Document Intelligence → $125.00, Office Depot, 2024-01-14  
   - Receipt 3: Classified as "other" → Mistral OCR → fallback processing
4. Aggregated result with all receipts, metadata, and best confidence scores

**Fallback**: If Azure Vision not configured or detection fails, processes original image as before

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
