#!/bin/bash

# Azure App Service Startup Script for Fresh Deployment
# This script ensures a completely clean deployment environment

set -e  # Exit on any error

echo "🚀 Starting fresh deployment process..."
echo "⏰ Timestamp: $(date -Iseconds)"

# Remove any existing node_modules to prevent stale dependencies
if [ -d "node_modules" ]; then
    echo "🧹 Removing existing node_modules..."
    rm -rf node_modules
fi

# Clean any temporary files and caches
echo "🧽 Cleaning temporary files..."
rm -rf tmp temp cache .tmp
rm -rf /tmp/npm-* 2>/dev/null || true

# Install dependencies fresh
echo "📦 Installing dependencies..."
npm install

# Rebuild native modules for Azure environment
echo "🔧 Rebuilding native modules..."
npm rebuild better-sqlite3 || echo "⚠️ Warning: better-sqlite3 rebuild failed, will use in-memory fallback"

# Run custom cleanup if script exists
if npm run | grep -q "cleanup"; then
    echo "🧹 Running application cleanup..."
    npm run cleanup
else
    echo "⚠️ No cleanup script found, using manual cleanup..."

    # Manual cleanup if script missing
    rm -rf uploads/* 2>/dev/null || true
    rm -f backend/data.sqlite* 2>/dev/null || true
    rm -rf temp tmp cache 2>/dev/null || true
fi

# Start the application
echo "🌟 Starting application..."
exec npm start