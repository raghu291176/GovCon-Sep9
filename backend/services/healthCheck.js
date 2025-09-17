/**
 * Health Check Service
 * Monitors external API endpoints and system health
 */

import { logger, LogCategory } from './logService.js';

export class HealthCheckService {
  constructor() {
    this.checks = new Map();
    this.results = new Map();
    this.isRunning = false;
    this.intervalId = null;
    
    // Initialize health checks
    this.initializeChecks();
  }

  initializeChecks() {
    // Azure OpenAI API Health Check
    this.addCheck('azure_openai', {
      name: 'Azure OpenAI API',
      description: 'LLM processing and chat completions',
      url: process.env.AZURE_OPENAI_ENDPOINT,
      method: 'GET',
      headers: {
        'api-key': process.env.AZURE_OPENAI_API_KEY || process.env.OPENAI_API_KEY
      },
      timeout: 10000,
      expectedStatus: [200, 401, 403], // 401/403 means API is responding but auth might be wrong
      critical: true
    });

    // Azure Document Intelligence Health Check
    this.addCheck('azure_document_intelligence', {
      name: 'Azure Document Intelligence',
      description: 'OCR and document processing',
      url: process.env.DOCUMENT_INTELLIGENCE_ENDPOINT,
      method: 'GET',
      headers: {
        'Ocp-Apim-Subscription-Key': process.env.DOCUMENT_INTELLIGENCE_KEY
      },
      timeout: 10000,
      expectedStatus: [200, 401, 403],
      critical: true
    });


    // Mistral OCR Health Check
    this.addCheck('mistral_ocr', {
      name: 'Mistral OCR API',
      description: 'Alternative OCR processing',
      url: process.env.AZURE_FOUNDRY_MISTRAL_ENDPOINT,
      method: 'GET',
      headers: this.getMistralHeaders(),
      timeout: 10000,
      expectedStatus: [200, 401, 403],
      critical: false
    });
  }

  getMistralHeaders() {
    const key = process.env.AZURE_FOUNDRY_MISTRAL_KEY;
    const scheme = String(process.env.AZURE_FOUNDRY_MISTRAL_AUTH_SCHEME || 'api-key').toLowerCase();
    
    if (scheme === 'bearer') {
      return { 'Authorization': `Bearer ${key}` };
    }
    return { 'api-key': key };
  }

  addCheck(id, config) {
    this.checks.set(id, {
      id,
      ...config,
      lastChecked: null,
      consecutiveFailures: 0
    });
  }

  async runSingleCheck(id) {
    const check = this.checks.get(id);
    if (!check) {
      throw new Error(`Health check '${id}' not found`);
    }

    const startTime = Date.now();
    let result = {
      id,
      name: check.name,
      description: check.description,
      status: 'unknown',
      responseTime: 0,
      error: null,
      timestamp: new Date().toISOString(),
      critical: check.critical
    };

    try {
      // Skip check if no URL configured
      if (!check.url) {
        result.status = 'not_configured';
        result.error = 'Endpoint URL not configured';
        return result;
      }

      // Skip if no API key configured
      if (check.headers && Object.values(check.headers).some(v => !v || v === 'undefined')) {
        result.status = 'not_configured';
        result.error = 'API key not configured';
        return result;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), check.timeout);

      try {
        const response = await fetch(check.url, {
          method: check.method,
          headers: check.headers,
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        
        result.responseTime = Date.now() - startTime;
        result.statusCode = response.status;

        if (check.expectedStatus.includes(response.status)) {
          result.status = 'healthy';
          check.consecutiveFailures = 0;
        } else {
          result.status = 'unhealthy';
          result.error = `Unexpected status code: ${response.status}`;
          check.consecutiveFailures++;
        }

      } catch (fetchError) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError') {
          result.status = 'timeout';
          result.error = 'Request timeout';
        } else {
          result.status = 'unhealthy';
          result.error = fetchError.message;
        }
        check.consecutiveFailures++;
      }

    } catch (error) {
      result.status = 'error';
      result.error = error.message;
      result.responseTime = Date.now() - startTime;
      check.consecutiveFailures++;
    }

    // Update check metadata
    check.lastChecked = new Date();
    
    // Store result
    this.results.set(id, result);

    // Log critical failures
    if (check.critical && result.status !== 'healthy' && result.status !== 'not_configured') {
      logger.error(LogCategory.EXTERNAL_API, `Critical API health check failed: ${check.name}`, {
        check_id: id,
        status: result.status,
        error: result.error,
        response_time: result.responseTime,
        consecutive_failures: check.consecutiveFailures
      });
    }

    return result;
  }

  async runAllChecks() {
    const results = {};
    const promises = Array.from(this.checks.keys()).map(async (id) => {
      try {
        const result = await this.runSingleCheck(id);
        results[id] = result;
      } catch (error) {
        results[id] = {
          id,
          name: this.checks.get(id).name,
          status: 'error',
          error: error.message,
          timestamp: new Date().toISOString()
        };
      }
    });

    await Promise.allSettled(promises);
    
    // Log overall health summary
    const healthy = Object.values(results).filter(r => r.status === 'healthy').length;
    const total = Object.keys(results).length;
    const criticalIssues = Object.values(results).filter(r => r.critical && r.status !== 'healthy' && r.status !== 'not_configured').length;

    logger.info(LogCategory.SYSTEM, 'Health check completed', {
      healthy_count: healthy,
      total_count: total,
      critical_issues: criticalIssues,
      summary: results
    });

    return results;
  }

  startPeriodicChecks(intervalMs = 5 * 60 * 1000) { // 5 minutes default
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    
    // Run initial check
    this.runAllChecks().catch(error => {
      logger.error(LogCategory.SYSTEM, 'Initial health check failed', { error: error.message });
    });

    // Schedule periodic checks
    this.intervalId = setInterval(() => {
      this.runAllChecks().catch(error => {
        logger.error(LogCategory.SYSTEM, 'Periodic health check failed', { error: error.message });
      });
    }, intervalMs);

    logger.info(LogCategory.SYSTEM, 'Health check service started', { 
      interval_minutes: intervalMs / 60000,
      checks_configured: this.checks.size 
    });
  }

  stopPeriodicChecks() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    
    logger.info(LogCategory.SYSTEM, 'Health check service stopped');
  }

  getResults() {
    return Object.fromEntries(this.results);
  }

  getSystemStatus() {
    const results = this.getResults();
    const checks = Object.values(results);
    
    const critical = checks.filter(c => c.critical);
    const criticalHealthy = critical.filter(c => c.status === 'healthy' || c.status === 'not_configured');
    
    let overallStatus = 'healthy';
    if (critical.length > 0 && criticalHealthy.length < critical.length) {
      overallStatus = 'degraded';
    }
    if (criticalHealthy.length === 0 && critical.length > 0) {
      overallStatus = 'unhealthy';
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks: results,
      summary: {
        total: checks.length,
        healthy: checks.filter(c => c.status === 'healthy').length,
        critical_total: critical.length,
        critical_healthy: criticalHealthy.length
      }
    };
  }
}

// Create singleton instance
export const healthCheckService = new HealthCheckService();