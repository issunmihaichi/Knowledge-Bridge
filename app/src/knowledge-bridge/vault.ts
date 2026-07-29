import type { VaultFile, VaultFileMetadata } from "./model";

export const KNOWLEDGE_BRIDGE_LEDGER_PATH = ".knowledge-bridge/graph.db";
const RECENT_VAULT_PATH_KEY = "knowledge-bridge.recent-vault-path";

export interface VaultAdapter {
  readonly name: string;
  readonly persistence: "browser" | "vault";
  listMarkdown(signal?: AbortSignal): AsyncGenerator<VaultFile>;
  listMarkdownMetadata(signal?: AbortSignal): AsyncGenerator<VaultFileMetadata>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  readBinary(path: string): Promise<Uint8Array | undefined>;
  writeBinary(path: string, bytes: Uint8Array): Promise<void>;
}

type DirectoryHandleWithEntries = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

async function* walkDirectory(directory: FileSystemDirectoryHandle, prefix = ""): AsyncGenerator<VaultFile> {
  for await (const [name, handle] of (directory as DirectoryHandleWithEntries).entries()) {
    if (name === ".knowledge-bridge" || name === ".obsidian") continue;
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      yield* walkDirectory(handle as FileSystemDirectoryHandle, path);
    } else if (name.toLowerCase().endsWith(".md")) {
      const file = await (handle as FileSystemFileHandle).getFile();
      yield { path, content: await file.text(), modifiedAt: file.lastModified, size: file.size };
    }
  }
}

async function resolveFile(
  root: FileSystemDirectoryHandle,
  path: string,
  create = false,
): Promise<FileSystemFileHandle> {
  const parts = path.split("/").filter(Boolean);
  let directory = root;
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create });
  return directory.getFileHandle(parts.at(-1)!, { create });
}

async function* walkDirectoryMetadata(
  directory: FileSystemDirectoryHandle,
  prefix = "",
): AsyncGenerator<VaultFileMetadata> {
  for await (const [name, handle] of (directory as DirectoryHandleWithEntries).entries()) {
    if (name === ".knowledge-bridge" || name === ".obsidian") continue;
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      yield* walkDirectoryMetadata(handle as FileSystemDirectoryHandle, path);
    } else if (name.toLowerCase().endsWith(".md")) {
      const file = await (handle as FileSystemFileHandle).getFile();
      yield { path, modifiedAt: file.lastModified, size: file.size };
    }
  }
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_OS_PLUGIN_INTERNALS__" in window;
}

function vaultPathParts(path: string): string[] {
  return path.split(/[\\/]/).filter(Boolean);
}

export class TauriVaultAdapter implements VaultAdapter {
  constructor(private readonly root: string) {}
  readonly persistence = "vault" as const;
  get rootPath(): string {
    return this.root;
  }
  get name(): string {
    return vaultPathParts(this.root).at(-1) ?? this.root;
  }

  private async resolve(path: string): Promise<string> {
    const { join } = await import("@tauri-apps/api/path");
    return join(this.root, ...vaultPathParts(path));
  }

  private async ensureParent(path: string): Promise<void> {
    const parts = vaultPathParts(path);
    if (parts.length < 2) return;
    const { join } = await import("@tauri-apps/api/path");
    const { mkdir } = await import("@tauri-apps/plugin-fs");
    await mkdir(await join(this.root, ...parts.slice(0, -1)), { recursive: true });
  }

  private async *walk(directory: string, prefix: string, signal?: AbortSignal): AsyncGenerator<VaultFile> {
    const [{ readDir, readTextFile, stat }, { join }] = await Promise.all([
      import("@tauri-apps/plugin-fs"),
      import("@tauri-apps/api/path"),
    ]);
    for (const entry of await readDir(directory)) {
      if (signal?.aborted) return;
      if (entry.name === ".knowledge-bridge" || entry.name === ".obsidian") continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = await join(directory, entry.name);
      if (entry.isDirectory) {
        yield* this.walk(absolutePath, path, signal);
      } else if (entry.isFile && entry.name.toLowerCase().endsWith(".md")) {
        const [content, fileInfo] = await Promise.all([readTextFile(absolutePath), stat(absolutePath)]);
        yield {
          path,
          content,
          size: fileInfo.size,
          modifiedAt: fileInfo.mtime?.getTime() ?? Date.now(),
        };
      }
    }
  }

  private async *walkMetadata(
    directory: string,
    prefix: string,
    signal?: AbortSignal,
  ): AsyncGenerator<VaultFileMetadata> {
    const [{ readDir, stat }, { join }] = await Promise.all([
      import("@tauri-apps/plugin-fs"),
      import("@tauri-apps/api/path"),
    ]);
    for (const entry of await readDir(directory)) {
      if (signal?.aborted) return;
      if (entry.name === ".knowledge-bridge" || entry.name === ".obsidian") continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = await join(directory, entry.name);
      if (entry.isDirectory) {
        yield* this.walkMetadata(absolutePath, path, signal);
      } else if (entry.isFile && entry.name.toLowerCase().endsWith(".md")) {
        const fileInfo = await stat(absolutePath);
        yield { path, size: fileInfo.size, modifiedAt: fileInfo.mtime?.getTime() ?? 0 };
      }
    }
  }

  async *listMarkdown(signal?: AbortSignal): AsyncGenerator<VaultFile> {
    yield* this.walk(this.root, "", signal);
  }

  async *listMarkdownMetadata(signal?: AbortSignal): AsyncGenerator<VaultFileMetadata> {
    yield* this.walkMetadata(this.root, "", signal);
  }

  async read(path: string): Promise<string> {
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    return readTextFile(await this.resolve(path));
  }

  async write(path: string, content: string): Promise<void> {
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await this.ensureParent(path);
    await writeTextFile(await this.resolve(path), content);
  }

  async readBinary(path: string): Promise<Uint8Array | undefined> {
    const { exists, readFile } = await import("@tauri-apps/plugin-fs");
    const absolutePath = await this.resolve(path);
    return (await exists(absolutePath)) ? readFile(absolutePath) : undefined;
  }

  async writeBinary(path: string, bytes: Uint8Array): Promise<void> {
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    await this.ensureParent(path);
    await writeFile(await this.resolve(path), bytes);
  }
}

export class BrowserVaultAdapter implements VaultAdapter {
  constructor(private readonly root: FileSystemDirectoryHandle) {}
  readonly persistence = "vault" as const;
  get name(): string {
    return this.root.name;
  }
  async *listMarkdown(signal?: AbortSignal): AsyncGenerator<VaultFile> {
    if (signal?.aborted) return;
    yield* walkDirectory(this.root, "");
  }
  async *listMarkdownMetadata(signal?: AbortSignal): AsyncGenerator<VaultFileMetadata> {
    if (signal?.aborted) return;
    yield* walkDirectoryMetadata(this.root, "");
  }
  async read(path: string): Promise<string> {
    return (await (await resolveFile(this.root, path)).getFile()).text();
  }
  async write(path: string, content: string): Promise<void> {
    const writable = await (await resolveFile(this.root, path, true)).createWritable();
    await writable.write(content);
    await writable.close();
  }
  async readBinary(path: string): Promise<Uint8Array | undefined> {
    try {
      const file = await (await resolveFile(this.root, path)).getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") return undefined;
      throw error;
    }
  }
  async writeBinary(path: string, bytes: Uint8Array): Promise<void> {
    const writable = await (await resolveFile(this.root, path, true)).createWritable();
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    await writable.write(buffer);
    await writable.close();
  }
}

export class DemoVaultAdapter implements VaultAdapter {
  readonly name = "浏览器暂存";
  readonly persistence = "browser" as const;
  private readonly files = new Map<string, string>([
    ["Notes/DNA 与基因.md", "---\nkb-id: dna\n---\n\n# DNA 与基因\n\n[[信息传递机制]]"],
    ["Notes/信息传递机制.md", "---\nkb-id: expression\n---\n\n# 信息传递机制\n\n转录、翻译与调控。"],
    ["Sources/肿瘤细胞状态研究.md", "---\nkb-id: paper\n---\n\n# 肿瘤细胞状态研究\n\n[[空间转录组]]"],
  ]);
  private readonly binaryFiles = new Map<string, Uint8Array>();
  private revision = 1;
  async *listMarkdown(signal?: AbortSignal): AsyncGenerator<VaultFile> {
    for (const [path, content] of this.files) {
      if (signal?.aborted) return;
      yield { path, content, size: content.length, modifiedAt: this.revision };
      await Promise.resolve();
    }
  }
  async *listMarkdownMetadata(signal?: AbortSignal): AsyncGenerator<VaultFileMetadata> {
    for (const [path, content] of this.files) {
      if (signal?.aborted) return;
      yield { path, size: content.length, modifiedAt: this.revision };
      await Promise.resolve();
    }
  }
  async read(path: string): Promise<string> {
    return this.files.get(path) ?? "";
  }
  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    this.revision += 1;
  }
  async readBinary(path: string): Promise<Uint8Array | undefined> {
    const bytes = this.binaryFiles.get(path);
    return bytes?.slice();
  }
  async writeBinary(path: string, bytes: Uint8Array): Promise<void> {
    this.binaryFiles.set(path, bytes.slice());
  }
}

export async function pickVault(): Promise<VaultAdapter> {
  if (isTauriRuntime()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ title: "选择 Knowledge Bridge Vault", directory: true, multiple: false });
    if (typeof selected !== "string") throw new DOMException("已取消选择 Vault", "AbortError");
    return new TauriVaultAdapter(selected);
  }
  const picker = (
    window as Window & { showDirectoryPicker?: (options?: { mode: "readwrite" }) => Promise<FileSystemDirectoryHandle> }
  ).showDirectoryPicker;
  if (!picker) throw new Error("当前浏览器不支持本地文件夹访问，请使用 Chromium 浏览器。");
  return new BrowserVaultAdapter(await picker({ mode: "readwrite" }));
}

/** Remember only a desktop folder path; graph contents stay in the selected Vault. */
export function rememberRecentVault(adapter: VaultAdapter): void {
  if (!(adapter instanceof TauriVaultAdapter) || typeof localStorage === "undefined") return;
  localStorage.setItem(RECENT_VAULT_PATH_KEY, adapter.rootPath);
}

/**
 * Reopen the last desktop Vault when it still exists. Browser folders require
 * a fresh permission grant, so browser mode keeps using its local ledger.
 */
export async function restoreRecentVault(): Promise<TauriVaultAdapter | undefined> {
  if (!isTauriRuntime() || typeof localStorage === "undefined") return undefined;
  const root = localStorage.getItem(RECENT_VAULT_PATH_KEY);
  if (!root) return undefined;
  const { exists } = await import("@tauri-apps/plugin-fs");
  if (await exists(root)) return new TauriVaultAdapter(root);
  localStorage.removeItem(RECENT_VAULT_PATH_KEY);
  return undefined;
}
