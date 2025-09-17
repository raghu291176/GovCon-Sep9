/**
 * Rate Limiting Middleware
 * Implements rate limiting for API endpoints, especially file uploads
 */

import { logger, LogCategory } from '../services/logService.js';

class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 15 * 60 * 1000; // 15 minutes
    this.maxRequests = options.max || 100; // requests per window
    this.keyGenerator = options.keyGenerator || this.defaultKeyGenerator;
    this.skipSuccessfulRequests = options.skipSuccessfulRequests || false;
    this.skipFailedRequests = options.skipFailedRequests || false;
    this.message = options.message || 'Too many requests, please try again later.';
    
    // In-memory store (in production, use Redis)
    this.store = new Map();
    
    // Cleanup interval to prevent memory leaks
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.windowMs);
  }

  defaultKeyGenerator(req) {
    // Use IP address as default key
    return req.ip || req.connection?.remoteAddress || 'unknown';
  }

  cleanup() {
    const now = Date.now();
    for (const [key, data] of this.store.entries()) {
      if (now - data.resetTime > this.windowMs) {
        this.store.delete(key);
      }
    }
  }

  middleware() {
    return (req, res, next) => {
      const key = this.keyGenerator(req);
      const now = Date.now();
      
      let record = this.store.get(key);
      
      // Initialize or reset if window expired
      if (!record || now - record.resetTime > this.windowMs) {
        record = {
          count: 0,
          resetTime: now,
          firstRequest: now
        };
        this.store.set(key, record);
      }
      
      // Check if limit exceeded
      if (record.count >= this.maxRequests) {
        logger.warn(LogCategory.SECURITY, 'Rate limit exceeded', {
          ip: key,
          endpoint: req.path,
          method: req.method,
          count: record.count,
          limit: this.maxRequests
        });
        
        res.status(429).json({
          error: 'Rate limit exceeded',
          message: this.message,
          retryAfter: Math.ceil((this.windowMs - (now - record.resetTime)) / 1000)
        });
        return;
      }
      
      // Increment counter
      record.count++;
      
      // Add rate limit headers
      res.set({
        'X-RateLimit-Limit': this.maxRequests,
        'X-RateLimit-Remaining': Math.max(0, this.maxRequests - record.count),
        'X-RateLimit-Reset': new Date(record.resetTime + this.windowMs).toISOString()
      });
      
      // Log if approaching limit
      if (record.count >= this.maxRequests * 0.8) {
        logger.warn(LogCategory.SECURITY, 'Rate limit warning', {
          ip: key,
          endpoint: req.path,
          count: record.count,
          limit: this.maxRequests,
          remaining: this.maxRequests - record.count
        });
      }
      
      next();
    };
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.store.clear();
  }
}

// Predefined rate limiters for different use cases
export const rateLimiters = {
  // General API rate limiting
  general: new RateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // 1000 requests per 15 minutes
    message: 'Too many requests from this IP, please try again after 15 minutes.'
  }),
  
  // File upload rate limiting (stricter)
  upload: new RateLimiter({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 50, // 50 uploads per 10 minutes
    message: 'Too many file uploads, please try again after 10 minutes.',
    keyGenerator: (req) => {
      // Consider both IP and user agent for uploads
      const ip = req.ip || req.connection?.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';
      return `${ip}:${userAgent.slice(0, 50)}`;
    }
  }),
  
  // Authentication attempts (very strict)
  auth: new RateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per 15 minutes
    message: 'Too many authentication attempts, please try again after 15 minutes.',
    skipSuccessfulRequests: true // Only count failed attempts
  }),
  
  // LLM/AI processing (moderate)
  llm: new RateLimiter({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 20, // 20 LLM requests per 5 minutes
    message: 'Too many AI processing requests, please try again after 5 minutes.'
  }),
  
  // Document processing (moderate)
  processing: new RateLimiter({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 30, // 30 processing requests per 5 minutes
    message: 'Too many document processing requests, please try again after 5 minutes.'
  })
};

// Factory function for custom rate limiters
export function createRateLimiter(options) {
  return new RateLimiter(options);
}

// Middleware helper for easy use
export function rateLimit(type = 'general') {
  if (!rateLimiters[type]) {
    throw new Error(`Unknown rate limiter type: ${type}`);
  }
  return rateLimiters[type].middleware();
}

// Global cleanup function
export function cleanupRateLimiters() {
  Object.values(rateLimiters).forEach(limiter => limiter.destroy());
}

// Auto-cleanup on process exit
process.on('SIGINT', cleanupRateLimiters);
process.on('SIGTERM', cleanupRateLimiters);