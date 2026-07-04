import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Express } from 'express';
import { registerProviderKind } from './providers/registry.js';

/**
 * Plugin system. A plugin is a folder inside `plugins/` (next to the repo
 * root, or set EMERALD_PLUGINS_DIR) containing an `index.mjs` that exports:
 *
 *   export default function register(api) { ... }
 *
 * The `api` object is the stable extension surface — see docs/PLUGINS.md.
 */
export interface PluginApi {
  /** Mount custom HTTP routes under /api/plugins/<pluginName>/ */
  addRoute(subpath: string, handler: (req: unknown, res: unknown) => void): void;
  /** Register a new AI provider kind usable from Settings. */
  registerProviderKind: typeof registerProviderKind;
  /** Register a command shown in the client command palette. */
  addCommand(cmd: { id: string; title: string; description?: string }): void;
  log(...args: unknown[]): void;
}

export interface LoadedPlugin {
  name: string;
  commands: { id: string; title: string; description?: string }[];
  error?: string;
}

export async function loadPlugins(app: Express, pluginsDir: string): Promise<LoadedPlugin[]> {
  const loaded: LoadedPlugin[] = [];
  if (!fs.existsSync(pluginsDir)) return loaded;

  for (const name of fs.readdirSync(pluginsDir)) {
    const entry = path.join(pluginsDir, name, 'index.mjs');
    if (!fs.existsSync(entry)) continue;
    const plugin: LoadedPlugin = { name, commands: [] };
    try {
      const mod = await import(pathToFileURL(entry).href);
      const api: PluginApi = {
        addRoute(subpath, handler) {
          app.all(`/api/plugins/${name}${subpath.startsWith('/') ? subpath : '/' + subpath}`, handler as never);
        },
        registerProviderKind,
        addCommand(cmd) { plugin.commands.push(cmd); },
        log: (...args) => console.log(`[plugin:${name}]`, ...args),
      };
      await mod.default?.(api);
      console.log(`[plugins] loaded: ${name}`);
    } catch (err) {
      plugin.error = (err as Error).message;
      console.warn(`[plugins] failed to load ${name}:`, plugin.error);
    }
    loaded.push(plugin);
  }
  return loaded;
}
