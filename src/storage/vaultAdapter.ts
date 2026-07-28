import type { VaultFile } from '../domain/types'

export interface VaultAdapter {
  readonly name: string
  listMarkdown(signal?: AbortSignal): AsyncGenerator<VaultFile>
  read(path: string): Promise<string>
  write(path: string, content: string): Promise<void>
  readBinary(path: string): Promise<Uint8Array | undefined>
  writeBinary(path: string, content: Uint8Array): Promise<void>
}

async function* walkDirectory(directory: FileSystemDirectoryHandle, prefix = ''): AsyncGenerator<VaultFile> {
  for await (const [name, handle] of directory.entries()) {
    if (name === '.knowledge-bridge' || name === '.obsidian') continue
    const path = prefix ? `${prefix}/${name}` : name
    if (handle.kind === 'directory') {
      yield* walkDirectory(handle as FileSystemDirectoryHandle, path)
    } else if (name.toLowerCase().endsWith('.md')) {
      const file = await (handle as FileSystemFileHandle).getFile()
      yield { path, content: await file.text(), modifiedAt: file.lastModified, size: file.size }
    }
  }
}

async function resolveFile(root: FileSystemDirectoryHandle, path: string, create = false): Promise<FileSystemFileHandle> {
  const parts = path.split('/').filter(Boolean)
  let directory = root
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create })
  return directory.getFileHandle(parts.at(-1)!, { create })
}

export class BrowserVaultAdapter implements VaultAdapter {
  constructor(private readonly root: FileSystemDirectoryHandle) {}
  get name(): string { return this.root.name }

  async *listMarkdown(signal?: AbortSignal): AsyncGenerator<VaultFile> {
    for await (const file of walkDirectory(this.root)) {
      if (signal?.aborted) return
      yield file
    }
  }

  async read(path: string): Promise<string> {
    return (await (await resolveFile(this.root, path)).getFile()).text()
  }

  async write(path: string, content: string): Promise<void> {
    const handle = await resolveFile(this.root, path, true)
    const writable = await handle.createWritable()
    await writable.write(content)
    await writable.close()
  }

  async readBinary(path: string): Promise<Uint8Array | undefined> {
    try {
      return new Uint8Array(await (await (await resolveFile(this.root, path)).getFile()).arrayBuffer())
    } catch { return undefined }
  }

  async writeBinary(path: string, content: Uint8Array): Promise<void> {
    const handle = await resolveFile(this.root, path, true)
    const writable = await handle.createWritable()
    await writable.write(content as BlobPart)
    await writable.close()
  }
}

export class DemoVaultAdapter implements VaultAdapter {
  readonly name = '生物学知识库'
  private files = new Map<string, string>([
    ['Notes/DNA 与基因.md', '---\nkb-id: dna\n---\n\n# DNA 与基因\n\n遗传信息储存在 DNA 的碱基序列中。\n\n[[信息传递机制]]'],
    ['Notes/信息传递机制.md', '---\nkb-id: expression\n---\n\n# 信息传递机制\n\n信息经过转录、翻译并受到调控。'],
    ['Sources/肿瘤细胞状态研究.md', '---\nkb-id: paper\n---\n\n# 肿瘤细胞状态研究\n\n研究观察到肿瘤内部存在多个表达亚群。\n\n[[空间转录组]]'],
  ])
  private binaries = new Map<string, Uint8Array>()

  async *listMarkdown(signal?: AbortSignal): AsyncGenerator<VaultFile> {
    for (const [path, content] of this.files) {
      if (signal?.aborted) return
      yield { path, content, size: content.length, modifiedAt: Date.now() }
      await Promise.resolve()
    }
  }

  async read(path: string): Promise<string> { return this.files.get(path) ?? '' }
  async write(path: string, content: string): Promise<void> { this.files.set(path, content) }
  async readBinary(path: string): Promise<Uint8Array | undefined> { return this.binaries.get(path) }
  async writeBinary(path: string, content: Uint8Array): Promise<void> { this.binaries.set(path, content) }
}

export async function pickVault(): Promise<VaultAdapter> {
  if (!window.showDirectoryPicker) throw new Error('当前浏览器不支持本地文件夹访问，请使用 Chromium 浏览器。')
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
  return new BrowserVaultAdapter(handle)
}
