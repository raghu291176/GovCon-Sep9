/**
 * Log Analysis Dashboard UI Component
 * Provides real-time log monitoring and analytics for the POC - Audit Materials System
 */

let logsChart = null;
let logRefreshInterval = null;

export function renderLogDashboard() {
    return `
        <div id="log-dashboard" class="log-dashboard">
            <div class="log-dashboard-header">
                <h2>📊 System Logs & Analytics</h2>
                <div class="log-controls">
                    <select id="log-time-range" onchange="updateLogAnalytics()">
                        <option value="1h">Last Hour</option>
                        <option value="24h" selected>Last 24 Hours</option>
                        <option value="7d">Last 7 Days</option>
                        <option value="30d">Last 30 Days</option>
                    </select>
                    <button onclick="refreshLogs()" class="refresh-btn">🔄 Refresh</button>
                    <button onclick="clearOldLogs()" class="clear-btn">🧹 Clear Old</button>
                </div>
            </div>

            <div class="log-metrics-grid">
                <div class="metric-card">
                    <div class="metric-title">System Health</div>
                    <div class="metric-value" id="system-health">LOADING</div>
                    <div class="metric-subtitle">Current Status</div>
                </div>
                <div class="metric-card">
                    <div class="metric-title">Total Logs</div>
                    <div class="metric-value" id="total-logs">-</div>
                    <div class="metric-subtitle">In Selected Period</div>
                </div>
                <div class="metric-card">
                    <div class="metric-title">Error Rate</div>
                    <div class="metric-value" id="error-rate">-</div>
                    <div class="metric-subtitle">Errors/Total Logs</div>
                </div>
                <div class="metric-card">
                    <div class="metric-title">Memory Usage</div>
                    <div class="metric-value" id="memory-usage">-</div>
                    <div class="metric-subtitle">Heap Used</div>
                </div>
            </div>

            <div class="log-charts-row">
                <div class="chart-container">
                    <h3>Log Levels Distribution</h3>
                    <canvas id="log-levels-chart" width="400" height="200"></canvas>
                </div>
                <div class="chart-container">
                    <h3>Categories Distribution</h3>
                    <div id="categories-list" class="categories-list"></div>
                </div>
            </div>

            <div class="log-tables-section">
                <div class="log-table-container">
                    <h3>Recent Logs <span id="log-count" class="count-badge">0</span></h3>
                    <div class="log-filters">
                        <button class="quick-btn" onclick="quickFilterApiRequests()">API Traffic</button>
                        <button class="quick-btn" onclick="quickFilterAll()">All</button>
                        <select id="level-filter" onchange="filterLogs()">
                            <option value="">All Levels</option>
                            <option value="ERROR">Errors</option>
                            <option value="WARN">Warnings</option>
                            <option value="INFO">Info</option>
                            <option value="DEBUG">Debug</option>
                            <option value="AUDIT">Audit</option>
                        </select>
                        <select id="category-filter" onchange="filterLogs()">
                            <option value="">All Categories</option>
                            <option value="SYSTEM">System</option>
                            <option value="GL_OPERATIONS">GL Operations</option>
                            <option value="DOCUMENT_PROCESSING">Document Processing</option>
                            <option value="LLM_PROCESSING">LLM Processing</option>
                            <option value="FAR_AUDIT">FAR Audit</option>
                            <option value="API_REQUEST">API Requests</option>
                            <option value="SECURITY">Security</option>
                        </select>
                        <input type="text" id="search-logs" placeholder="Search logs..." onkeyup="filterLogs()">
                    </div>
                    <div id="logs-table" class="logs-table"></div>
                </div>

                <div class="errors-container">
                    <h3>Top Error Patterns <span id="error-patterns-count" class="count-badge">0</span></h3>
                    <div id="error-patterns" class="error-patterns"></div>
                </div>
            </div>
        </div>

        <style>
            .log-dashboard {
                padding: 20px;
                background: #f8f9fa;
                min-height: 100vh;
            }

            .log-dashboard-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 20px;
                padding: 20px;
                background: white;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }

            .log-controls {
                display: flex;
                gap: 10px;
                align-items: center;
            }

            .log-controls select,
            .log-controls button {
                padding: 8px 12px;
                border: 1px solid #ddd;
                border-radius: 4px;
                background: white;
            }

            .refresh-btn {
                background: #28a745;
                color: white;
                border-color: #28a745;
            }

            .clear-btn {
                background: #dc3545;
                color: white;
                border-color: #dc3545;
            }

            .log-metrics-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 20px;
                margin-bottom: 20px;
            }

            .metric-card {
                background: white;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                text-align: center;
            }

            .metric-title {
                font-size: 14px;
                color: #666;
                margin-bottom: 8px;
            }

            .metric-value {
                font-size: 24px;
                font-weight: bold;
                margin-bottom: 4px;
            }

            .metric-value.healthy { color: #28a745; }
            .metric-value.warning { color: #ffc107; }
            .metric-value.critical { color: #dc3545; }

            .metric-subtitle {
                font-size: 12px;
                color: #999;
            }

            .log-charts-row {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 20px;
                margin-bottom: 20px;
            }

            .chart-container {
                background: white;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }

            .categories-list {
                max-height: 200px;
                overflow-y: auto;
            }

            .category-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px 0;
                border-bottom: 1px solid #f0f0f0;
            }

            .log-tables-section {
                display: grid;
                grid-template-columns: 2fr 1fr;
                gap: 20px;
            }

            .log-table-container,
            .errors-container {
                background: white;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }

            .log-filters {
                display: flex;
                gap: 10px;
                margin-bottom: 15px;
                flex-wrap: wrap;
            }

            .log-filters select,
            .log-filters input {
                padding: 6px 10px;
                border: 1px solid #ddd;
                border-radius: 4px;
                flex: 1;
                min-width: 120px;
            }

            .quick-btn {
                background: #f3f4f6;
                border: 1px solid #d1d5db;
                color: #111827;
                padding: 6px 10px;
                border-radius: 4px;
                cursor: pointer;
            }
            .quick-btn:hover { background: #e5e7eb; }

            .logs-table {
                max-height: 400px;
                overflow-y: auto;
                border: 1px solid #ddd;
                border-radius: 4px;
            }

            .log-entry {
                padding: 8px 12px;
                border-bottom: 1px solid #f0f0f0;
                font-family: monospace;
                font-size: 13px;
            }

            .log-entry:last-child {
                border-bottom: none;
            }

            .log-entry.ERROR { background-color: #fff5f5; border-left: 4px solid #dc3545; }
            .log-entry.WARN { background-color: #fffaf0; border-left: 4px solid #ffc107; }
            .log-entry.INFO { background-color: #f0f9ff; border-left: 4px solid #007bff; }
            .log-entry.DEBUG { background-color: #f8f9fa; border-left: 4px solid #6c757d; }
            .log-entry.AUDIT { background-color: #f0fff4; border-left: 4px solid #28a745; }

            .log-timestamp {
                color: #666;
                font-size: 11px;
            }

            .log-level {
                display: inline-block;
                padding: 2px 6px;
                border-radius: 3px;
                font-size: 10px;
                font-weight: bold;
                margin: 0 8px;
            }

            .log-level.ERROR { background: #dc3545; color: white; }
            .log-level.WARN { background: #ffc107; color: black; }
            .log-level.INFO { background: #007bff; color: white; }
            .log-level.DEBUG { background: #6c757d; color: white; }
            .log-level.AUDIT { background: #28a745; color: white; }

            .log-category {
                color: #495057;
                font-weight: bold;
            }

            .log-message {
                margin-top: 4px;
                color: #212529;
            }

            .error-patterns {
                max-height: 400px;
                overflow-y: auto;
            }

            .error-pattern {
                padding: 10px;
                border-bottom: 1px solid #f0f0f0;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .error-pattern:last-child {
                border-bottom: none;
            }

            .error-pattern-text {
                font-family: monospace;
                font-size: 13px;
                color: #dc3545;
            }

            .error-pattern-count {
                background: #dc3545;
                color: white;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 12px;
                font-weight: bold;
            }

            .count-badge {
                background: #007bff;
                color: white;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 12px;
                font-weight: bold;
                margin-left: 8px;
            }
        </style>
    `;
}

export async function initializeLogDashboard() {
    // Load initial data
    await Promise.all([
        updateLogAnalytics(),
        updateSystemHealth(),
        loadRecentLogs()
    ]);

    // Start live stream for recent logs (SSE)
    try { startLogStream(); } catch (e) { console.warn('SSE not available, using polling only'); }

    // Keep analytics and health fresh (lighter endpoints)
    logRefreshInterval = setInterval(() => {
        updateLogAnalytics();
        updateSystemHealth();
    }, 30000); // Refresh analytics/health every 30 seconds
}

export function destroyLogDashboard() {
    if (logRefreshInterval) {
        clearInterval(logRefreshInterval);
        logRefreshInterval = null;
    }
    if (logsChart) {
        logsChart.destroy();
        logsChart = null;
    }
}

window.updateLogAnalytics = async function() {
    const timeRange = document.getElementById('log-time-range').value;
    
    try {
        const response = await fetch(`/api/logs/analytics?timeRange=${timeRange}`);
        const analytics = await response.json();
        
        // Update metrics
        document.getElementById('total-logs').textContent = analytics.totalLogs.toLocaleString();
        document.getElementById('error-rate').textContent = 
            (analytics.systemHealth.errorRate * 100).toFixed(1) + '%';
        document.getElementById('memory-usage').textContent = 
            (analytics.systemHealth.memoryUsage.heapUsed / 1024 / 1024).toFixed(1) + ' MB';
        
        // Update charts
        updateLogLevelsChart(analytics.levelCounts);
        updateCategoriesList(analytics.categoryCounts);
        updateErrorPatterns(analytics.topErrors);
        
    } catch (error) {
        console.error('Failed to update log analytics:', error);
    }
};

window.updateSystemHealth = async function() {
    try {
        const response = await fetch('/api/system/health');
        const health = await response.json();
        
        const healthElement = document.getElementById('system-health');
        healthElement.textContent = health.status;
        healthElement.className = `metric-value ${health.status.toLowerCase()}`;
        
    } catch (error) {
        console.error('Failed to update system health:', error);
    }
};

function updateLogLevelsChart(levelCounts) {
    const canvas = document.getElementById('log-levels-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    
    const ctx = canvas.getContext('2d');
    
    if (logsChart) {
        logsChart.destroy();
    }
    
    const data = Object.entries(levelCounts).filter(([_, count]) => count > 0);
    
    if (data.length === 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#666';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('No logs in selected period', canvas.width / 2, canvas.height / 2);
        return;
    }
    
    logsChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: data.map(([level]) => level),
            datasets: [{
                data: data.map(([_, count]) => count),
                backgroundColor: [
                    '#dc3545', // ERROR
                    '#ffc107', // WARN  
                    '#007bff', // INFO
                    '#6c757d', // DEBUG
                    '#28a745'  // AUDIT
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

function updateCategoriesList(categoryCounts) {
    const container = document.getElementById('categories-list');
    if (!container) return;
    
    const categories = Object.entries(categoryCounts)
        .filter(([_, count]) => count > 0)
        .sort(([_, a], [__, b]) => b - a);
    
    if (categories.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">No activity in selected period</div>';
        return;
    }
    
    container.innerHTML = categories.map(([category, count]) => `
        <div class="category-item">
            <span class="category-name">${category.replace('_', ' ')}</span>
            <span class="category-count">${count.toLocaleString()}</span>
        </div>
    `).join('');
}

function updateErrorPatterns(topErrors) {
    const container = document.getElementById('error-patterns');
    const countElement = document.getElementById('error-patterns-count');
    
    if (!container || !countElement) return;
    
    countElement.textContent = topErrors.length;
    
    if (topErrors.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">No errors in selected period</div>';
        return;
    }
    
    container.innerHTML = topErrors.map(({ pattern, count }) => `
        <div class="error-pattern">
            <span class="error-pattern-text">${pattern}</span>
            <span class="error-pattern-count">${count}</span>
        </div>
    `).join('');
}

window.loadRecentLogs = async function() {
    const levelFilter = document.getElementById('level-filter')?.value || '';
    const categoryFilter = document.getElementById('category-filter')?.value || '';
    const searchQuery = document.getElementById('search-logs')?.value || '';
    
    try {
        let url = '/api/logs?limit=50';
        if (levelFilter) url += `&level=${levelFilter}`;
        if (categoryFilter) url += `&category=${categoryFilter}`;
        if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;
        
        const response = await fetch(url);
        const result = await response.json();
        
        const container = document.getElementById('logs-table');
        const countElement = document.getElementById('log-count');
        
        if (container) {
            container.innerHTML = result.logs.map(log => `
                <div class="log-entry ${log.level}">
                    <div>
                        <span class="log-timestamp">${new Date(log.timestamp).toLocaleString()}</span>
                        <span class="log-level ${log.level}">${log.level}</span>
                        <span class="log-category">${log.category}</span>
                    </div>
                    <div class="log-message">${log.message}</div>
                </div>
            `).join('');
        }
        
        if (countElement) {
            countElement.textContent = result.logs.length;
        }
        
    } catch (error) {
        console.error('Failed to load recent logs:', error);
    }
};

window.filterLogs = function() {
    loadRecentLogs();
};

window.refreshLogs = function() {
    updateLogAnalytics();
    updateSystemHealth();
    loadRecentLogs();
};

// Quick filters
window.quickFilterApiRequests = function() {
    const level = document.getElementById('level-filter');
    const cat = document.getElementById('category-filter');
    const search = document.getElementById('search-logs');
    if (level) level.value = '';
    if (cat) cat.value = 'API_REQUEST';
    if (search) search.value = '';
    loadRecentLogs();
};

window.quickFilterAll = function() {
    const level = document.getElementById('level-filter');
    const cat = document.getElementById('category-filter');
    const search = document.getElementById('search-logs');
    if (level) level.value = '';
    if (cat) cat.value = '';
    if (search) search.value = '';
    loadRecentLogs();
};

function startLogStream() {
    const container = document.getElementById('logs-table');
    const countElement = document.getElementById('log-count');
    if (!container) return;

    const es = new EventSource('/api/logs/stream');
    const maxEntries = 200;

    es.onmessage = (ev) => {
        try {
            const log = JSON.parse(ev.data);
            const entry = document.createElement('div');
            entry.className = `log-entry ${log.level}`;
            entry.innerHTML = `
                <div>
                    <span class="log-timestamp">${new Date(log.timestamp).toLocaleString()}</span>
                    <span class="log-level ${log.level}">${log.level}</span>
                    <span class="log-category">${log.category}</span>
                </div>
                <div class="log-message">${log.message}</div>
            `;
            container.prepend(entry);
            while (container.childElementCount > maxEntries) container.lastElementChild.remove();
            if (countElement) countElement.textContent = container.childElementCount;
        } catch (_) {}
    };

    es.onerror = () => {
        // Fall back to polling if stream fails
        es.close();
        console.warn('Log stream disconnected; falling back to polling');
        // Aggressive polling fallback for recent logs
        setInterval(() => loadRecentLogs(), 5000);
    };
}

window.clearOldLogs = async function() {
    if (!confirm('Clear old logs? This will remove logs older than 7 days.')) {
        return;
    }
    
    try {
        const response = await fetch('/api/logs/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ retentionDays: 7 })
        });
        
        const result = await response.json();
        alert(`Cleared ${result.clearedCount} old logs. ${result.remainingCount} logs remaining.`);
        
        // Refresh dashboard
        refreshLogs();
        
    } catch (error) {
        console.error('Failed to clear logs:', error);
        alert('Failed to clear logs. Please try again.');
    }
};
