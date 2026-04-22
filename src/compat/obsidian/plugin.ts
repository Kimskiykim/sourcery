import type { Command, PluginManifest } from "./types.js";
import type { ObsidianAppClient } from "./app.js";

export abstract class Plugin {
  private readonly commands: Command[] = [];

  protected constructor(
    public readonly app: ObsidianAppClient,
    public readonly manifest: PluginManifest
  ) {}

  abstract onload(): Promise<void> | void;

  onunload(): Promise<void> | void {}

  addCommand(command: Command): void {
    this.commands.push(command);
  }

  getCommands(): Command[] {
    return [...this.commands];
  }
}
