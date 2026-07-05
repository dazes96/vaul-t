import type { Provider } from './types.js';
import type { ProviderConfig, Settings } from '../config.js';
import { getSecret } from '../config.js';
import { ollamaProvider } from './ollama.js';
import { openaiCompatProvider } from './openaiCompat.js';
import { anthropicProvider } from './anthropic.js';
import { geminiProvider } from './gemini.js';

type Factory = (cfg: ProviderConfig, apiKey?: string) => Provider;

const factories: Record<string, Factory> = {
  'ollama': (c) => ollamaProvider(c.baseUrl, c.model),
  'openai-compatible': (c, k) => openaiCompatProvider(c.baseUrl, c.model, k),
  'anthropic': (c, k) => anthropicProvider(c.baseUrl, c.model, k),
  'gemini': (c, k) => geminiProvider(c.baseUrl, c.model, k),
};

/** Plugins can call this to add entirely new provider kinds. */
export function registerProviderKind(kind: string, factory: Factory): void {
  factories[kind] = factory;
}

export function buildProvider(settings: Settings, providerId?: string): Provider {
  const id = providerId || settings.activeProvider;
  const cfg = settings.providers.find(p => p.id === id);
  if (!cfg) {
    const available = settings.providers.map(p => p.id).join(', ') || 'none configured';
    throw new Error(`No AI provider "${id || '(unset)'}" — open Settings and pick an active provider. Configured: ${available}.`);
  }
  const factory = factories[cfg.kind];
  if (!factory) throw new Error(`Provider "${cfg.id}" has an unknown kind "${cfg.kind}". Fix it in Settings (kinds: ollama, openai-compatible, anthropic, gemini).`);
  const apiKey = cfg.apiKeyRef ? getSecret(cfg.apiKeyRef) : undefined;
  return factory(cfg, apiKey);
}
