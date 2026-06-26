// Plugins API (sprint 38)

export interface PluginEntry {
  id: string;
  path: string;
}

export interface PluginsAPI {
  list: () => Promise<PluginEntry[]>;
}
