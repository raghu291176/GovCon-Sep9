/**
 * Debug Logger Utility
 * Provides conditional logging based on environment and debug flags
 */

export class DebugLogger {
  constructor() {
    this.isDebugMode = this.detectDebugMode();
  }

  detectDebugMode() {
    // Check various debug indicators
    return (
      // URL parameter
      new URLSearchParams(window.location.search).has('debug') ||
      // Local storage flag
      localStorage.getItem('debug') === 'true' ||
      // Development environment
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      // Console command to enable debug
      window.__DEBUG_ENABLED === true
    );
  }

  log(...args) {
    if (this.isDebugMode) {
      console.log(...args);
    }
  }

  warn(...args) {
    if (this.isDebugMode) {
      console.warn(...args);
    }
  }

  error(...args) {
    // Always show errors
    console.error(...args);
  }

  info(...args) {
    if (this.isDebugMode) {
      console.info(...args);
    }
  }

  debug(...args) {
    if (this.isDebugMode) {
      console.debug(...args);
    }
  }

  // Always log certain important events
  critical(...args) {
    console.log(...args);
  }

  // Enable/disable debug mode programmatically
  enable() {
    this.isDebugMode = true;
    localStorage.setItem('debug', 'true');
    window.__DEBUG_ENABLED = true;
  }

  disable() {
    this.isDebugMode = false;
    localStorage.removeItem('debug');
    window.__DEBUG_ENABLED = false;
  }

  get enabled() {
    return this.isDebugMode;
  }
}

// Create singleton instance
export const debugLogger = new DebugLogger();

// Make it globally available for console commands
window.debugLogger = debugLogger;