const crypto = require('crypto');

function makeLogger(reqId) {
  const base = { reqId };
  const ts = () => new Date().toISOString();
  return {
    info: (msg, meta) => console.log(ts(), '[INFO]', msg, JSON.stringify({ ...base, ...(meta || {}) })),
    warn: (msg, meta) => console.warn(ts(), '[WARN]', msg, JSON.stringify({ ...base, ...(meta || {}) })),
    error: (msg, meta) => console.error(ts(), '[ERROR]', msg, JSON.stringify({ ...base, ...(meta || {}) })),
  };
}

function reqContextMiddleware(req, res, next) {
  const hdrId = req.headers['x-request-id'];
  const reqId = typeof hdrId === 'string' && hdrId ? hdrId : crypto.randomUUID();
  res.setHeader('x-request-id', reqId);
  req.reqId = reqId;
  req.logger = makeLogger(reqId);
  next();
}

module.exports = { makeLogger, reqContextMiddleware };
