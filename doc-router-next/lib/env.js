const { z } = require('zod');

const EnvSchema = z.object({
  PORT: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 8080))
    .pipe(z.number().int().positive()),
  NODE_ENV: z.enum(['production', 'development']).default('development'),
  ALLOWED_ORIGINS: z.string().optional(),
  MAX_UPLOAD_MB: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 10))
    .pipe(z.number().int().positive()),

  AZURE_DI_ENDPOINT: z.string().url().optional(),
  AZURE_DI_API_VERSION: z.string().default('2024-07-31'),
  AZURE_DI_KEY: z.string().optional(),
  AZURE_DI_INVOICE_MODEL: z.string().default('prebuilt-invoice'),
  AZURE_DI_RECEIPT_MODEL: z.string().default('prebuilt-receipt'),
  AZURE_DI_GENERAL_MODEL: z.string().default('prebuilt-general-document'),

  MISTRAL_OCR_ENDPOINT: z.string().url().optional(),
  MISTRAL_OCR_API_KEY: z.string().optional(),
});

function buildEnv() {
  const parsed = EnvSchema.parse(process.env);
  const allowedOrigins = (parsed.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { ...parsed, allowedOrigins };
}

const env = buildEnv();

module.exports = { env };

