import type { VaultFile } from "./model";

export interface VaultAdapter {
  readonly name: string;
  listMarkdown(signal?: AbortSignal): AsyncGenerator<VaultFile>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
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

async function resolveFile(root: FileSystemDirectoryHandle, path: string, create = false): Promise<FileSystemFileHandle> {
  const parts = path.split("/").filter(Boolean);
  let directory = root;
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create });
  return directory.getFileHandle(parts.at(-1)!, { create });
}

export class BrowserVaultAdapter implements VaultAdapter {
  constructor(private readonly root: FileSystemDirectoryHandle) {}
  get name(): string {
    return this.root.name;
  }
  async *listMarkdown(signal?: AbortSignal): AsyncGenerator<VaultFile> {
    if (signal?.aborted) return;
    yield* walkDirectory(this.root, "");
  }
  async read(path: string): Promise<string> {
    return (await (await resolveFile(this.root, path)).getFile()).text();
  }
  async write(path: string, content: string): Promise<void> {
    const writable = await (await resolveFile(this.root, path, true)).createWritable();
    await writable.write(content);
    await writable.close();
  }
}

export class DemoVaultAdapter implements VaultAdapter {
  readonly name = "生物学知识库";
  private readonly files = new Map<string, string>([
    ["Notes/DNA 与基因.md", "---\nkb-id: dna\n---\n\n# DNA 与基因\n\n[[信息传递机制]]"],
    ["Notes/信息传递机制.md", "---\nkb-id: expression\n---\n\n# 信息传递机制\n\n转录、翻译与调控。"],
    ["Sources/肿瘤细胞状态研究.md", "---\nkb-id: paper\n---\n\n# 肿瘤细胞状态研究\n\n[[空间转录组]]"],
  ]);
  async *listMarkdown(signal?: AbortSignal): AsyncGenerator<VaultFile> {
    for (const [path, content] of this.files) {
      if (signal?.aborted) return;
      yield { path, content, size: content.length, modifiedAt: Date.now() };
      await Promise.resolve();
    }
  }
  async read(path: string): Promise<string> {
    return this.files.get(path) ?? "";
  }
  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
}

export async function pickVault(): Promise<VaultAdapter> {
  const picker = (window as Window & { showDirectoryPicker?: (options?: { mode: "readwrite" }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!picker) throw new Error("当前浏览器不支持本地文件夹访问，请使用 Chromium 浏览器。");
  return new BrowserVaultAdapter(await picker({ mode: "readwrite" }));
}
