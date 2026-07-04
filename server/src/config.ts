import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataDir } from './util/paths.js';
import { writeFileAtomic } from './util/atomic.js';

export interface ProviderConfig {
  id: string;            // user-chosen name, e.g. "ollama-local"
  kind: 'ollama' | 'openai-compatible' | 'anthropic' | 'gemini';
  baseUrl: string;
  model: string;
  apiKeyRef?: string;    // key name inside encrypted secrets, never the key itself
}

export interface Settings {
  activeProvider: string;
  providers: ProviderConfig[];
  theme: 'dark' | 'light' | string;
  beginnerMode: boolean;
  autocomplete: boolean;
  agentMaxSteps: number;         // user-adjustable, not a hard product limit
  recentWorkspaces: string[];
  approvals: {
    fileDelete: boolean;
    terminalExec: boolean;
    gitReset: boolean;
    dependencyInstall: boolean;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  activeProvider: 'ollama',
  providers: [
    { id: 'ollama', kind: 'ollama', baseUrl: 'http://localhost:11434', model: 'qwen2.5-coder:7b' },
    { id: 'lm-studio', kind: 'openai-compatible', baseUrl: 'http://localhost:1234/v1', model: 'local-model' },
    { id: 'llama-cpp', kind: 'openai-compatible', baseUrl: 'http://localhost:8080/v1', model: 'default' },
    { id: 'vllm', kind: 'openai-compatible', baseUrl: 'http://localhost:8000/v1', model: 'default' },
  ],
  theme: 'dark',
  beginnerMode: false,
  autocomplete: true,
  agentMaxSteps: 50,
  recentWorkspaces: [],
  approvals: { fileDelete: true, terminalExec: true, gitReset: true, dependencyInstall: true },
};

function settingsPath() { return path.join(dataDir(), 'settings.json'); }
function keyPath() { return path.join(dataDir(), 'secret.key'); }
function secretsPath() { return path.join(dataDir(), 'secrets.enc'); }

function ensureDataDir() {
  fs.mkdirSync(dataDir(), { recursive: true });
}

export function loadSettings(): Settings {
  ensureDataDir();
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return { ...DEFAULT_SETTINGS, ...raw, approvals: { ...DEFAULT_SETTINGS.approvals, ...raw.approvals } };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings): void {
  ensureDataDir();
  writeFileAtomic(settingsPath(), JSON.stringify(s, null, 2));
}

// --- Encrypted secrets (API keys) ------------------------------------------
// AES-256-GCM with a locally generated key file. This keeps keys out of
// plain-text settings and casual backups; it is not a defense against an
// attacker who already controls your user account (documented in SECURITY).

function getKey(): Buffer {
  ensureDataDir();
  try {
    return fs.readFileSync(keyPath());
  } catch {
    const key = crypto.randomBytes(32);
    writeFileAtomic(keyPath(), key, 0o600);
    return key;
  }
}

type SecretMap = Record<string, string>;

function readSecrets(): SecretMap {
  try {
    const blob = fs.readFileSync(secretsPath());
    const iv = blob.subarray(0, 12);
    const tag = blob.subarray(12, 28);
    const data = blob.subarray(28);
    const d = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString('utf8'));
  } catch {
    return {};
  }
}

function writeSecrets(map: SecretMap): void {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(map), 'utf8'), c.final()]);
  writeFileAtomic(secretsPath(), Buffer.concat([iv, c.getAuthTag(), enc]), 0o600);
}

export function setSecret(name: string, value: string): void {
  const map = readSecrets();
  if (value) map[name] = value; else delete map[name];
  writeSecrets(map);
}

export function getSecret(name: string): string | undefined {
  return readSecrets()[name];
}

export function listSecretNames(): string[] {
  return Object.keys(readSecrets());
}
