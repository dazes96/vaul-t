import { create } from 'zustand';
import { apiGet, apiPost } from '../api';

export interface Tab {
  path: string;
  content: string;
  savedContent: string;
  kind: 'text' | 'image';
  base64?: string;
}

export interface Settings {
  activeProvider: string;
  providers: { id: string; kind: string; baseUrl: string; model: string; apiKeyRef?: string }[];
  theme: string;
  beginnerMode: boolean;
  autocomplete: boolean;
  agentMaxSteps: number;
  approvals: { fileDelete: boolean; terminalExec: boolean; gitReset: boolean; dependencyInstall: boolean };
}

export type SidePanel = 'explorer' | 'search' | 'git' | 'history';
export type BottomTab = 'terminal' | 'output' | 'problems';

interface AppState {
  workspace: string;
  settings: Settings | null;
  tabs: Tab[];
  activePath: string | null;
  sidePanel: SidePanel;
  bottomTab: BottomTab;
  bottomVisible: boolean;
  aiVisible: boolean;
  paletteOpen: boolean;
  settingsOpen: boolean;
  output: string[];
  treeVersion: number;   // bump to make the explorer refresh

  init(): Promise<void>;
  openFile(path: string): Promise<void>;
  closeTab(path: string): void;
  setContent(path: string, content: string): void;
  saveActive(): Promise<void>;
  setActive(path: string): void;
  set<K extends keyof AppState>(key: K, value: AppState[K]): void;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  appendOutput(line: string): void;
  refreshTree(): void;
}

export const useStore = create<AppState>((set, get) => ({
  workspace: '',
  settings: null,
  tabs: [],
  activePath: null,
  sidePanel: 'explorer',
  bottomTab: 'terminal',
  bottomVisible: true,
  aiVisible: true,
  paletteOpen: false,
  settingsOpen: false,
  output: [],
  treeVersion: 0,

  async init() {
    const [ws, s] = await Promise.all([
      apiGet<{ workspace: string }>('/api/workspace'),
      apiGet<{ settings: Settings }>('/api/settings'),
    ]);
    set({ workspace: ws.workspace, settings: s.settings });
    document.documentElement.dataset.theme = s.settings.theme === 'light' ? 'light' : 'dark';
  },

  async openFile(path: string) {
    const existing = get().tabs.find(t => t.path === path);
    if (existing) { set({ activePath: path }); return; }
    const res = await apiGet<{ kind: 'text' | 'image'; content?: string; base64?: string }>(
      `/api/fs/read?path=${encodeURIComponent(path)}`);
    const tab: Tab = res.kind === 'image'
      ? { path, content: '', savedContent: '', kind: 'image', base64: res.base64 }
      : { path, content: res.content ?? '', savedContent: res.content ?? '', kind: 'text' };
    set({ tabs: [...get().tabs, tab], activePath: path });
  },

  closeTab(path: string) {
    const tabs = get().tabs.filter(t => t.path !== path);
    const activePath = get().activePath === path ? (tabs.at(-1)?.path ?? null) : get().activePath;
    set({ tabs, activePath });
  },

  setContent(path: string, content: string) {
    set({ tabs: get().tabs.map(t => (t.path === path ? { ...t, content } : t)) });
  },

  async saveActive() {
    const { activePath, tabs } = get();
    const tab = tabs.find(t => t.path === activePath);
    if (!tab || tab.kind !== 'text') return;
    await apiPost('/api/fs/write', { path: tab.path, content: tab.content });
    set({ tabs: get().tabs.map(t => (t.path === tab.path ? { ...t, savedContent: t.content } : t)) });
  },

  setActive(path: string) { set({ activePath: path }); },
  set(key, value) { set({ [key]: value } as Pick<AppState, typeof key>); },

  async updateSettings(patch) {
    const settings = { ...get().settings!, ...patch };
    set({ settings });
    await apiPost('/api/settings', patch);
    if (patch.theme) document.documentElement.dataset.theme = patch.theme === 'light' ? 'light' : 'dark';
  },

  appendOutput(line) { set({ output: [...get().output.slice(-500), line] }); },
  refreshTree() { set({ treeVersion: get().treeVersion + 1 }); },
}));
