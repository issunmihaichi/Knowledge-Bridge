import type { IndexProgress, PendingMention, VaultFile } from "./model";
import { parseKbId, parseLinks, parseTitle } from "./sync";
import type { VaultAdapter } from "./vault";

export interface IndexedFile {
  path: string;
  kbId?: string;
  title: string;
  links: Array<{ target: string; edgeId?: string; raw: string }>;
  modifiedAt: number;
  size: number;
}

export async function collectVaultFiles(
  adapter: VaultAdapter,
  signal: AbortSignal,
  onProgress: (progress: IndexProgress) => void,
): Promise<VaultFile[]> {
  const files: VaultFile[] = [];
  let current = 0;
  onProgress({ phase: "scanning", current: 0, total: 0 });
  for await (const file of adapter.listMarkdown(signal)) {
    files.push(file);
    current += 1;
    if (current % 50 === 0) onProgress({ phase: "scanning", current, total: 0 });
  }
  return files;
}

export async function indexMarkdown(
  files: VaultFile[],
  signal: AbortSignal,
  onProgress: (progress: IndexProgress) => void,
): Promise<IndexedFile[]> {
  const results: IndexedFile[] = [];
  for (const [index, file] of files.entries()) {
    if (signal.aborted) break;
    results.push({
      path: file.path,
      kbId: parseKbId(file.content),
      title: parseTitle(file.content, file.path),
      links: parseLinks(file.content),
      modifiedAt: file.modifiedAt,
      size: file.size,
    });
    if (index % 100 === 0) {
      onProgress({ phase: "scanning", current: index + 1, total: files.length });
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    }
  }
  onProgress({ phase: signal.aborted ? "cancelled" : "complete", current: results.length, total: files.length });
  return results;
}

export function toPending(indexed: IndexedFile[], knownIds: Set<string>): PendingMention[] {
  const pending: PendingMention[] = [];
  for (const file of indexed) {
    if (!file.kbId || !knownIds.has(file.kbId)) {
      pending.push({
        id: `lineage:${file.path}`,
        filePath: file.path,
        targetTitle: file.title,
        kind: "lineage",
        raw: file.kbId ?? "kb-id missing",
      });
    }
    for (const link of file.links) {
      if (!link.edgeId)
        pending.push({
          id: `mention:${file.path}:${link.raw}`,
          filePath: file.path,
          sourceId: file.kbId,
          targetTitle: link.target,
          kind: "wikilink",
          raw: link.raw,
        });
    }
  }
  return pending;
}
