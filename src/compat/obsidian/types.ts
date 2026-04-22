export interface TAbstractFile {
  path: string;
  name: string;
}

export interface TFile extends TAbstractFile {
  basename: string;
  extension: string;
  stat: {
    ctime: number;
    mtime: number;
    size: number;
  };
}

export interface CachedMetadata {
  links: Array<{ link: string }>;
  backlinks: string[];
  tags: string[];
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion?: string;
  description?: string;
}

export interface Command {
  id: string;
  name: string;
  callback: () => void | Promise<void>;
}
