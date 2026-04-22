import type { PluginManifest } from "./types.js";
import { Plugin } from "./plugin.js";
import type { ObsidianAppClient } from "./app.js";

export type PluginConstructor<T extends Plugin = Plugin> = new (
  app: ObsidianAppClient,
  manifest: PluginManifest
) => T;

export class PluginHost {
  private readonly plugins = new Map<string, Plugin>();

  constructor(private readonly app: ObsidianAppClient) {}

  async load(PluginClass: PluginConstructor, manifest: PluginManifest): Promise<Plugin> {
    const plugin = new PluginClass(this.app, manifest);
    await plugin.onload();
    this.plugins.set(manifest.id, plugin);
    return plugin;
  }

  async unload(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return;
    }

    await plugin.onunload();
    this.plugins.delete(pluginId);
  }

  list(): Plugin[] {
    return [...this.plugins.values()];
  }
}
