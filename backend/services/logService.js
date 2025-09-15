import crypto from 'crypto';

/**
 * Persistent Logging Service for POC - Audit Materials System
 * Stores logs in memory and provides analysis capabilities
 */

// In-memory log storage
const memory = {
  logs: [],
  maxLogs: 10000 // Limit to prevent memory issues
};

// Live subscribers for runtime streaming (SSE)
const subscribers = new Set();

export function subscribeLogs(handler) {
  if (typeof handler === 'function') {
    subscribers.add(handler);
    return () => subscribers.delete(handler);
  }
  return () => {};
}

function broadcast(logEntry) {
  for (const fn of subscribers) {
    try { fn(logEntry); } catch (_) {}
  }
}

// Log levels
export const LogLevel = {
  ERROR: 'ERROR',
  WARN: 'WARN', 
  INFO: 'INFO',
  DEBUG: 'DEBUG',
  AUDIT: 'AUDIT'
};

// Log categories for better organization
export const LogCategory = {
  SYSTEM: 'SYSTEM',
  DOCUMENT_PROCESSING: 'DOCUMENT_PROCESSING',
  GL_OPERATIONS: 'GL_OPERATIONS',
  LLM_PROCESSING: 'LLM_PROCESSING',
  FAR_AUDIT: 'FAR_AUDIT',
  API_REQUEST: 'API_REQUEST',
  SECURITY: 'SECURITY'
};

/**
 * Create a structured log entry
 */
export function createLog(level, category, message, metadata = {}) {
  const logEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    metadata: {
      ...metadata,
      pid: process.pid,
      memory_usage: process.memoryUsage().heapUsed,
      uptime: process.uptime()
    }
  };

  // Add to memory store
  memory.logs.push(logEntry);
  
  // Maintain size limit
  if (memory.logs.length > memory.maxLogs) {
    memory.logs = memory.logs.slice(-memory.maxLogs);
  }

  // Notify live subscribers
  broadcast(logEntry);

  // Also log to console for immediate visibility
  const consoleMessage = `[${level}] ${category}: ${message}`;
  switch (level) {
    case LogLevel.ERROR:
      console.error(consoleMessage, metadata);
      break;
    case LogLevel.WARN:
      console.warn(consoleMessage, metadata);
      break;
    case LogLevel.DEBUG:
      console.debug(consoleMessage, metadata);
      break;
    default:
      console.log(consoleMessage, metadata);
  }

  return logEntry;
}

/**
 * Convenience logging methods
 */
export const logger = {
  error: (category, message, metadata) => createLog(LogLevel.ERROR, category, message, metadata),
  warn: (category, message, metadata) => createLog(LogLevel.WARN, category, message, metadata),
  info: (category, message, metadata) => createLog(LogLevel.INFO, category, message, metadata),
  debug: (category, message, metadata) => createLog(LogLevel.DEBUG, category, message, metadata),
  audit: (category, message, metadata) => createLog(LogLevel.AUDIT, category, message, metadata)
};

/**
 * Get logs with filtering and pagination
 */
export function getLogs(options = {}) {
  const {
    level = null,
    category = null,
    startDate = null,
    endDate = null,
    limit = 100,
    offset = 0,
    search = null
  } = options;

  let filtered = [...memory.logs];

  // Filter by level
  if (level) {
    filtered = filtered.filter(log => log.level === level);
  }

  // Filter by category
  if (category) {
    filtered = filtered.filter(log => log.category === category);
  }

  // Filter by date range
  if (startDate) {
    const start = new Date(startDate);
    filtered = filtered.filter(log => new Date(log.timestamp) >= start);
  }
  if (endDate) {
    const end = new Date(endDate);
    filtered = filtered.filter(log => new Date(log.timestamp) <= end);
  }

  // Search in message
  if (search) {
    const searchLower = search.toLowerCase();
    filtered = filtered.filter(log => 
      log.message.toLowerCase().includes(searchLower) ||
      JSON.stringify(log.metadata).toLowerCase().includes(searchLower)
    );
  }

  // Sort by timestamp (newest first)
  filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // Paginate
  const total = filtered.length;
  const logs = filtered.slice(offset, offset + limit);

  return {
    logs,
    total,
    offset,
    limit,
    hasMore: offset + limit < total
  };
}

/**
 * Get log analytics and statistics
 */
export function getLogAnalytics(timeRange = '24h') {
  const now = new Date();
  let startTime;

  switch (timeRange) {
    case '1h':
      startTime = new Date(now - 60 * 60 * 1000);
      break;
    case '24h':
      startTime = new Date(now - 24 * 60 * 60 * 1000);
      break;
    case '7d':
      startTime = new Date(now - 7 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      startTime = new Date(now - 30 * 24 * 60 * 60 * 1000);
      break;
    default:
      startTime = new Date(now - 24 * 60 * 60 * 1000);
  }

  const recentLogs = memory.logs.filter(log => new Date(log.timestamp) >= startTime);
  
  // Count by level
  const levelCounts = {};
  Object.values(LogLevel).forEach(level => levelCounts[level] = 0);
  
  // Count by category
  const categoryCounts = {};
  Object.values(LogCategory).forEach(category => categoryCounts[category] = 0);

  // Error patterns
  const errorPatterns = {};
  
  // Processing times for performance analysis
  const processingTimes = [];

  recentLogs.forEach(log => {
    levelCounts[log.level]++;
    categoryCounts[log.category]++;
    
    if (log.level === LogLevel.ERROR) {
      const pattern = log.message.split(' ').slice(0, 3).join(' '); // First 3 words
      errorPatterns[pattern] = (errorPatterns[pattern] || 0) + 1;
    }

    if (log.metadata.processing_time_ms) {
      processingTimes.push(log.metadata.processing_time_ms);
    }
  });

  // Calculate processing time statistics
  let processingStats = null;
  if (processingTimes.length > 0) {
    processingTimes.sort((a, b) => a - b);
    processingStats = {
      count: processingTimes.length,
      min: processingTimes[0],
      max: processingTimes[processingTimes.length - 1],
      avg: processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length,
      median: processingTimes[Math.floor(processingTimes.length / 2)],
      p95: processingTimes[Math.floor(processingTimes.length * 0.95)]
    };
  }

  // Top errors (sorted by frequency)
  const topErrors = Object.entries(errorPatterns)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10)
    .map(([pattern, count]) => ({ pattern, count }));

  return {
    timeRange,
    totalLogs: recentLogs.length,
    levelCounts,
    categoryCounts,
    topErrors,
    processingStats,
    systemHealth: {
      errorRate: recentLogs.length > 0 ? (levelCounts[LogLevel.ERROR] / recentLogs.length) : 0,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime()
    }
  };
}

/**
 * Clear old logs to prevent memory issues
 */
export function clearOldLogs(retentionDays = 7) {
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const initialCount = memory.logs.length;
  
  memory.logs = memory.logs.filter(log => new Date(log.timestamp) > cutoffDate);
  
  const clearedCount = initialCount - memory.logs.length;
  
  logger.info(LogCategory.SYSTEM, `Cleared ${clearedCount} old logs (retention: ${retentionDays} days)`, {
    initial_count: initialCount,
    remaining_count: memory.logs.length,
    cleared_count: clearedCount
  });

  return { clearedCount, remainingCount: memory.logs.length };
}

/**
 * Get system status and health metrics
 */
export function getSystemHealth() {
  const recentLogs = memory.logs.filter(log => 
    new Date(log.timestamp) > new Date(Date.now() - 60 * 60 * 1000) // Last hour
  );

  const errors = recentLogs.filter(log => log.level === LogLevel.ERROR);
  const warnings = recentLogs.filter(log => log.level === LogLevel.WARN);

  // Helper to parse api-version from an endpoint URL
  const parseApiVersion = (url) => {
    try {
      const u = new URL(url);
      return u.searchParams.get('api-version') || null;
    } catch {
      return null;
    }
  };

  const services = {
    content_understanding: {
      endpoint: process.env.CONTENT_UNDERSTANDING_ENDPOINT ? 'configured' : 'not_configured',
      key: process.env.CONTENT_UNDERSTANDING_KEY ? 'configured' : 'not_configured',
      receipt_analyzer: process.env.CONTENT_UNDERSTANDING_RECEIPT_ANALYZER_ID ? 'configured' : 'not_configured',
      invoice_analyzer: process.env.CONTENT_UNDERSTANDING_INVOICE_ANALYZER_ID ? 'configured' : 'not_configured',
      api_version: process.env.CONTENT_UNDERSTANDING_API_VERSION || 'unset',
      processing_location: process.env.CONTENT_UNDERSTANDING_PROCESSING_LOCATION ? 'set' : 'unset'
    },
    azure_openai: {
      endpoint: process.env.AZURE_OPENAI_ENDPOINT ? 'configured' : 'not_configured',
      key: process.env.OPENAI_API_KEY ? 'configured' : 'not_configured',
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT ? 'configured' : 'not_configured',
      api_version: process.env.AZURE_OPENAI_API_VERSION || 'unset'
    },
    azure_foundry_mistral: {
      endpoint: process.env.AZURE_FOUNDRY_MISTRAL_ENDPOINT ? 'configured' : 'not_configured',
      key: process.env.AZURE_FOUNDRY_MISTRAL_KEY ? 'configured' : 'not_configured',
      model: process.env.AZURE_FOUNDRY_MISTRAL_MODEL ? 'configured' : 'not_configured',
      api_version: parseApiVersion(process.env.AZURE_FOUNDRY_MISTRAL_ENDPOINT || '') || 'unset'
    }
  };

  return {
    status: errors.length > 10 ? 'CRITICAL' : warnings.length > 50 ? 'WARNING' : 'HEALTHY',
    totalLogs: memory.logs.length,
    recentActivity: recentLogs.length,
    recentErrors: errors.length,
    recentWarnings: warnings.length,
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime(),
    lastError: errors.length > 0 ? errors[0] : null,
    services
  };
}

export default {
  createLog,
  logger,
  getLogs,
  getLogAnalytics,
  clearOldLogs,
  getSystemHealth,
  LogLevel,
  LogCategory
};
