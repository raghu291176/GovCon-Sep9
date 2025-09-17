/**
 * Input Validation Middleware
 * Provides validation functions for API endpoints
 */

// Validation helper functions
const validators = {
  isString: (value) => typeof value === 'string',
  isNumber: (value) => typeof value === 'number' && !isNaN(value),
  isArray: (value) => Array.isArray(value),
  isObject: (value) => value !== null && typeof value === 'object' && !Array.isArray(value),
  isEmail: (value) => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
  isDate: (value) => {
    if (typeof value !== 'string') return false;
    const date = new Date(value);
    return !isNaN(date.getTime());
  },
  isUUID: (value) => {
    if (typeof value !== 'string') return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  },
  isAmount: (value) => {
    if (typeof value === 'number') return value >= 0;
    if (typeof value === 'string') {
      const num = parseFloat(value.replace(/[,$]/g, ''));
      return !isNaN(num) && num >= 0;
    }
    return false;
  }
};

// Sanitization functions
const sanitizers = {
  toString: (value) => String(value || '').trim(),
  toNumber: (value) => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const num = parseFloat(value.replace(/[,$]/g, ''));
      return isNaN(num) ? null : num;
    }
    return null;
  },
  escapeHtml: (value) => {
    if (typeof value !== 'string') return value;
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  },
  removeScripts: (value) => {
    if (typeof value !== 'string') return value;
    return value.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  }
};

// Schema validation
function validateSchema(data, schema) {
  const errors = [];
  const sanitized = {};

  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];
    
    // Check required fields
    if (rules.required && (value === undefined || value === null || value === '')) {
      errors.push(`Field '${field}' is required`);
      continue;
    }
    
    // Skip validation for optional empty fields
    if (!rules.required && (value === undefined || value === null || value === '')) {
      sanitized[field] = value;
      continue;
    }
    
    // Type validation
    if (rules.type && !validators[rules.type](value)) {
      errors.push(`Field '${field}' must be of type ${rules.type}`);
      continue;
    }
    
    // Length validation for strings
    if (rules.minLength && value.length < rules.minLength) {
      errors.push(`Field '${field}' must be at least ${rules.minLength} characters`);
    }
    if (rules.maxLength && value.length > rules.maxLength) {
      errors.push(`Field '${field}' exceeds maximum length of ${rules.maxLength} characters`);
    }
    
    // Range validation for numbers
    if (rules.min !== undefined && value < rules.min) {
      errors.push(`Field '${field}' must be at least ${rules.min}`);
    }
    if (rules.max !== undefined && value > rules.max) {
      errors.push(`Field '${field}' must not exceed ${rules.max}`);
    }
    
    // Array validation
    if (rules.arrayMaxLength && Array.isArray(value) && value.length > rules.arrayMaxLength) {
      errors.push(`Field '${field}' array exceeds maximum length of ${rules.arrayMaxLength}`);
    }
    
    // Custom validation
    if (rules.validate && typeof rules.validate === 'function') {
      const customResult = rules.validate(value);
      if (customResult !== true) {
        errors.push(customResult || `Field '${field}' failed custom validation`);
      }
    }
    
    // Sanitization
    let sanitizedValue = value;
    if (rules.sanitize) {
      for (const sanitizer of rules.sanitize) {
        if (sanitizers[sanitizer]) {
          sanitizedValue = sanitizers[sanitizer](sanitizedValue);
        }
      }
    }
    
    sanitized[field] = sanitizedValue;
  }
  
  return { errors, sanitized };
}

// Middleware factory
export function validateRequest(schema) {
  return (req, res, next) => {
    const { errors, sanitized } = validateSchema(req.body, schema);
    
    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors
      });
    }
    
    // Replace req.body with sanitized data
    req.body = { ...req.body, ...sanitized };
    next();
  };
}

// Query parameter validation
export function validateQuery(schema) {
  return (req, res, next) => {
    const { errors, sanitized } = validateSchema(req.query, schema);
    
    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Query validation failed',
        details: errors
      });
    }
    
    req.query = { ...req.query, ...sanitized };
    next();
  };
}

// URL parameter validation
export function validateParams(schema) {
  return (req, res, next) => {
    const { errors, sanitized } = validateSchema(req.params, schema);
    
    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Parameter validation failed',
        details: errors
      });
    }
    
    req.params = { ...req.params, ...sanitized };
    next();
  };
}

// Common validation schemas
export const schemas = {
  glEntry: {
    description: { 
      type: 'isString', 
      required: true, 
      maxLength: 500,
      sanitize: ['toString', 'escapeHtml', 'removeScripts']
    },
    amount: { 
      type: 'isAmount', 
      required: true,
      min: 0,
      max: 999999999
    },
    date: { 
      type: 'isDate', 
      required: true 
    },
    vendor: { 
      type: 'isString', 
      maxLength: 200,
      sanitize: ['toString', 'escapeHtml', 'removeScripts']
    },
    accountNumber: { 
      type: 'isString', 
      maxLength: 50,
      sanitize: ['toString', 'escapeHtml']
    }
  },
  
  pagination: {
    limit: { 
      type: 'isNumber', 
      min: 1, 
      max: 1000,
      sanitize: ['toNumber']
    },
    offset: { 
      type: 'isNumber', 
      min: 0,
      sanitize: ['toNumber']
    }
  },
  
  id: {
    id: { 
      type: 'isString', 
      required: true,
      maxLength: 100,
      sanitize: ['toString', 'escapeHtml']
    }
  },
  
  llmReview: {
    rows: {
      type: 'isArray',
      required: true,
      arrayMaxLength: 100,
      validate: (value) => {
        if (!Array.isArray(value)) return 'rows must be an array';
        if (value.length === 0) return 'rows array cannot be empty';
        return true;
      }
    }
  }
};

export { validators, sanitizers, validateSchema };