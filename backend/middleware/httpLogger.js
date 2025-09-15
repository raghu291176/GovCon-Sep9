import { logger, LogCategory } from '../services/logService.js';

function redactHeaders(src = {}) {
  const sensitive = new Set([
    'authorization',
    'proxy-authorization',
    'x-api-key',
    'ocp-apim-subscription-key',
    'api-key',
    'x-azure-sas',
    'cookie'
  ]);
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    const key = String(k || '').toLowerCase();
    out[k] = sensitive.has(key) ? '[REDACTED]' : v;
  }
  return out;
}

export function httpLogger(options = {}) {
  const enabled = (process.env.HTTP_LOGGING || 'on').toLowerCase() !== 'off';
  const maxBody = Number(process.env.HTTP_LOGGING_MAX_BODY || options.maxBody || 2048);

  return function httpLoggerMiddleware(req, res, next) {
    if (!enabled) return next();

    const start = Date.now();
    const { method } = req;
    const url = req.originalUrl || req.url;
    const httpVersion = `${req.httpVersionMajor}.${req.httpVersionMinor}`;

    // Gather request snapshot (avoid heavy bodies like multipart)
    let reqBody = undefined;
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    const isMultipart = ct.includes('multipart/form-data');
    const isJson = ct.includes('application/json');
    if (!isMultipart && isJson && req.body) {
      try {
        const str = JSON.stringify(req.body);
        reqBody = str.length > maxBody ? str.slice(0, maxBody) + `…(+${str.length - maxBody} chars)` : str;
      } catch (_) {}
    }

    const reqMeta = {
      direction: 'inbound',
      method,
      url,
      http_version: httpVersion,
      ip: req.ip,
      user_agent: req.headers['user-agent'],
      referer: req.headers['referer'] || req.headers['referrer'],
      headers: redactHeaders(req.headers || {}),
      query: req.query,
      body: reqBody
    };

    function onFinished() {
      res.removeListener('finish', onFinished);
      res.removeListener('close', onFinished);
      const duration = Date.now() - start;
      const status = res.statusCode;
      const length = res.getHeader('Content-Length');
      const respMeta = {
        ...reqMeta,
        status,
        duration_ms: duration,
        response_headers: redactHeaders(Object.fromEntries(Object.entries(res.getHeaders ? res.getHeaders() : {}))),
        content_length: typeof length === 'string' || typeof length === 'number' ? Number(length) : null,
        content_type: res.getHeader('Content-Type')
      };

      const msg = `${method} ${url} -> ${status} ${duration}ms`;
      if (status >= 500) logger.error(LogCategory.API_REQUEST, msg, respMeta);
      else if (status >= 400) logger.warn(LogCategory.API_REQUEST, msg, respMeta);
      else logger.info(LogCategory.API_REQUEST, msg, respMeta);
    }

    res.on('finish', onFinished);
    res.on('close', onFinished);
    next();
  };
}

export default httpLogger;

