// Simple JSON file-based config persistence for environments without SQLite
// Stores only app/LLM/DI configs; not intended for high-write paths.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config-store.json');

function ensureDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (_) {}
}

function readConfigFile() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function writeConfigFile(obj) {
  try {
    ensureDir();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(obj || {}, null, 2), 'utf-8');
  } catch (_) {}
}

export function loadAllConfigs(memory) {
  try {
    const data = readConfigFile();
    if (data && typeof data === 'object') {
      if (data.app_config && typeof data.app_config === 'object') memory.appConfig = data.app_config;
      if (data.llm_config && typeof data.llm_config === 'object') memory.llm = data.llm_config;
      if (data.di_config && typeof data.di_config === 'object') memory.di = data.di_config;
    }
  } catch (_) {}
}

export function saveConfig(key, obj) {
  try {
    const data = readConfigFile();
    data[String(key)] = obj || {};
    writeConfigFile(data);
  } catch (_) {}
}

