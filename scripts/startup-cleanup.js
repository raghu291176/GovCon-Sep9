#!/usr/bin/env node

/**
 * Startup Cleanup Script
 *
 * This script cleans the database and uploaded files every time the service starts.
 * It runs automatically on all service restarts to ensure a clean state.
 * Set CLEAN_ON_START=false to disable this behavior.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

// Configure upload directory
const PERSIST_DIR = process.env.UPLOAD_DIR || '/home/uploads';
let UPLOAD_DIR = PERSIST_DIR;

try {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
} catch (e) {
  console.warn('Could not create upload directory, falling back to local directory');
  UPLOAD_DIR = path.join(ROOT_DIR, 'uploads');
  try {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  } catch (e_inner) {
    console.error("Failed to create upload directory:", e_inner);
  }
}

/**
 * Clean all files and directories in the uploads folder
 */
function cleanUploadsDirectory() {
  try {
    console.log(`🧹 Cleaning uploads directory: ${UPLOAD_DIR}`);

    if (!fs.existsSync(UPLOAD_DIR)) {
      console.log('📁 Upload directory does not exist, creating it...');
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      return;
    }

    const entries = fs.readdirSync(UPLOAD_DIR, { withFileTypes: true });
    console.log(`📁 Found ${entries.length} entries to clean:`, entries.map(e => e.name));

    for (const entry of entries) {
      const fullPath = path.join(UPLOAD_DIR, entry.name);
      try {
        fs.rmSync(fullPath, { recursive: true, force: true });
        console.log(`✅ Deleted: ${entry.name}`);
      } catch (error) {
        console.error(`❌ Failed to delete ${entry.name}:`, error.message);
      }
    }

    console.log('🎉 Upload directory cleanup completed');
  } catch (error) {
    console.error('❌ Error cleaning uploads directory:', error.message);
  }
}

/**
 * Clean SQLite database file if it exists
 */
function cleanDatabase() {
  try {
    console.log('🗄️ Cleaning database...');

    const dbPath = path.join(ROOT_DIR, 'backend', 'data.sqlite');
    const dbShmPath = path.join(ROOT_DIR, 'backend', 'data.sqlite-shm');
    const dbWalPath = path.join(ROOT_DIR, 'backend', 'data.sqlite-wal');

    const filesToClean = [dbPath, dbShmPath, dbWalPath];
    let deletedCount = 0;

    for (const filePath of filesToClean) {
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          console.log(`✅ Deleted database file: ${path.basename(filePath)}`);
          deletedCount++;
        } catch (error) {
          console.error(`❌ Failed to delete ${path.basename(filePath)}:`, error.message);
        }
      }
    }

    if (deletedCount === 0) {
      console.log('📝 No existing database files found');
    } else {
      console.log(`🎉 Database cleanup completed (${deletedCount} files removed)`);
    }
  } catch (error) {
    console.error('❌ Error cleaning database:', error.message);
  }
}

/**
 * Clean any temporary or cache files
 */
function cleanTempFiles() {
  try {
    console.log('🧽 Cleaning temporary files...');

    const tempDirs = [
      path.join(ROOT_DIR, 'temp'),
      path.join(ROOT_DIR, 'tmp'),
      path.join(ROOT_DIR, 'cache')
    ];

    let cleanedCount = 0;

    for (const tempDir of tempDirs) {
      if (fs.existsSync(tempDir)) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
          console.log(`✅ Deleted temp directory: ${path.basename(tempDir)}`);
          cleanedCount++;
        } catch (error) {
          console.error(`❌ Failed to delete ${path.basename(tempDir)}:`, error.message);
        }
      }
    }

    if (cleanedCount === 0) {
      console.log('📝 No temporary directories found');
    } else {
      console.log(`🎉 Temp cleanup completed (${cleanedCount} directories removed)`);
    }
  } catch (error) {
    console.error('❌ Error cleaning temp files:', error.message);
  }
}

/**
 * Main cleanup function
 */
export function performStartupCleanup() {
  console.log('🚀 Starting service restart cleanup...');
  console.log('⏰ Timestamp:', new Date().toISOString());

  cleanUploadsDirectory();
  cleanDatabase();
  cleanTempFiles();

  console.log('✨ Startup cleanup completed successfully!');
  console.log('');
}

// Run cleanup if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  performStartupCleanup();
}