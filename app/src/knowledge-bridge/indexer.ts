import type { IndexProgress, PendingMention, VaultFile, VaultFileMetadata, VaultSnapshot } from "./model";
import { markdownBody, parseKbId, parseLinks, parseTitle } from "./sync";
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

export async function collectVaultMetadata(
  adapter: VaultAdapter,
  signal: AbortSignal,
  onProgress: (progress: IndexProgress) => void,
): Promise<VaultFileMetadata[]> {
  const files: VaultFileMetadata[] = [];
  onProgress({ phase: "scanning", current: 0, total: 0 });
  for await (const file of adapter.listMarkdownMetadata(signal)) {
    files.push(file);
    if (files.length % 100 === 0) onProgress({ phase: "scanning", current: files.length, total: 0 });
  }
  onProgress({ phase: signal.aborted ? "cancelled" : "scanning", current: 0, total: files.length });
  return files;
}

async function indexMarkdownWithWorker(
  files: VaultFile[],
  signal: AbortSignal,
  onProgress: (progress: IndexProgress) => void,
): Promise<IndexedFile[]> {
  const worker = new Worker(new URL("./indexWorker.ts", import.meta.url), { type: "module" });
  return new Promise<IndexedFile[]>((resolve, reject) => {
    const abort = () => {
      worker.terminate();
      reject(new DOMException("Indexing cancelled", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = (event) => {
      signal.removeEventListener("abort", abort);
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.onmessage = (
      event: MessageEvent<{ type: "progress"; current: number } | { type: "complete"; results: IndexedFile[] }>,
    ) => {
      if (event.data.type === "progress") {
        onProgress({ phase: "scanning", current: event.data.current, total: files.length });
        return;
      }
      signal.removeEventListener("abort", abort);
      worker.terminate();
      resolve(event.data.results);
    };
    worker.postMessage({ files });
  });
}

export async function indexMarkdown(
  files: VaultFile[],
  signal: AbortSignal,
  onProgress: (progress: IndexProgress) => void,
): Promise<IndexedFile[]> {
  if (files.length >= 200 && typeof Worker !== "undefined") {
    try {
      const results = await indexMarkdownWithWorker(files, signal, onProgress);
      onProgress({ phase: "complete", current: results.length, total: files.length });
      return results;
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }
  const results: IndexedFile[] = [];
  for (const [index, file] of files.entries()) {
    if (signal.aborted) break;
    results.push(parseVaultFile(file));
    if (index % 100 === 0) {
      onProgress({ phase: "scanning", current: index + 1, total: files.length });
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    }
  }
  onProgress({ phase: signal.aborted ? "cancelled" : "complete", current: results.length, total: files.length });
  return results;
}

export interface IncrementalIndexResult {
  indexed: IndexedFile[];
  changedFiles: VaultFile[];
  reusedCount: number;
  deletedCount: number;
}

/** Refresh only already-bound node sources whose Markdown body was read as changed. */
export function syncChangedNodeSources(snapshot: VaultSnapshot, changedFiles: VaultFile[]): VaultSnapshot {
  const sources = new Map(
    changedFiles.flatMap((file) => {
      const kbId = parseKbId(file.content);
      return kbId ? [[kbId, file] as const] : [];
    }),
  );
  let changed = false;
  const nodes = snapshot.nodes.map((node) => {
    const file = sources.get(node.id);
    if (!file) return node;
    const body = markdownBody(file.content);
    if (node.path === file.path && node.detailsMarkdown === body && node.status !== "missing-source") return node;
    changed = true;
    return {
      ...node,
      path: file.path,
      detailsMarkdown: body,
      status: node.status === "missing-source" ? ("formal" as const) : node.status,
    };
  });
  return changed ? { ...snapshot, nodes } : snapshot;
}

export async function indexVaultIncrementally(
  adapter: VaultAdapter,
  cached: IndexedFile[],
  signal: AbortSignal,
  onProgress: (progress: IndexProgress) => void,
): Promise<IncrementalIndexResult> {
  const metadata = await collectVaultMetadata(adapter, signal, onProgress);
  if (signal.aborted) return { indexed: [], changedFiles: [], reusedCount: 0, deletedCount: 0 };
  const cachedByPath = new Map(cached.map((file) => [file.path, file]));
  const currentPaths = new Set(metadata.map((file) => file.path));
  const changedMetadata = metadata.filter((file) => {
    const previous = cachedByPath.get(file.path);
    return !previous || previous.modifiedAt !== file.modifiedAt || previous.size !== file.size;
  });
  const changedFiles: VaultFile[] = [];
  const concurrency = 16;
  for (let offset = 0; offset < changedMetadata.length; offset += concurrency) {
    if (signal.aborted) break;
    const chunk = changedMetadata.slice(offset, offset + concurrency);
    const contents = await Promise.all(chunk.map((file) => adapter.read(file.path)));
    changedFiles.push(...chunk.map((file, index) => ({ ...file, content: contents[index] })));
    onProgress({
      phase: "scanning",
      current: Math.min(metadata.length, offset + chunk.length),
      total: metadata.length,
    });
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  }
  if (signal.aborted) {
    onProgress({ phase: "cancelled", current: changedFiles.length, total: metadata.length });
    return { indexed: [], changedFiles, reusedCount: 0, deletedCount: 0 };
  }
  const parsedChanged = await indexMarkdown(changedFiles, signal, onProgress);
  const merged = new Map(cached.filter((file) => currentPaths.has(file.path)).map((file) => [file.path, file]));
  for (const file of parsedChanged) merged.set(file.path, file);
  const indexed = metadata.flatMap((file) => {
    const value = merged.get(file.path);
    return value ? [value] : [];
  });
  const deletedCount = cached.filter((file) => !currentPaths.has(file.path)).length;
  const reusedCount = indexed.length - parsedChanged.length;
  onProgress({ phase: "complete", current: metadata.length, total: metadata.length });
  return { indexed, changedFiles, reusedCount, deletedCount };
}

function normalized(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export const INDEX_CACHE_METADATA_KEY = "markdown-index-v1";

export function parseVaultFile(file: VaultFile): IndexedFile {
  return {
    path: file.path,
    kbId: parseKbId(file.content),
    title: parseTitle(file.content, file.path),
    links: parseLinks(file.content),
    modifiedAt: file.modifiedAt,
    size: file.size,
  };
}

function similarityTerms(value: string): Set<string> {
  const terms = new Set<string>();
  for (const token of value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    terms.add(token);
    if (token.length > 2) {
      for (let index = 0; index < token.length - 1; index += 1) terms.add(token.slice(index, index + 2));
    }
  }
  return terms;
}

function termOverlap(left: string, right: string): number {
  const leftTerms = similarityTerms(left);
  const rightTerms = similarityTerms(right);
  if (leftTerms.size === 0 || rightTerms.size === 0) return 0;
  const overlap = [...leftTerms].filter((term) => rightTerms.has(term)).length;
  return overlap / new Set([...leftTerms, ...rightTerms]).size;
}

function lineageCandidates(
  file: IndexedFile,
  context?: Pick<VaultSnapshot, "nodes" | "relations">,
): PendingMention["candidates"] {
  if (!context) return [];
  const linkedTitles = new Set(file.links.map((link) => normalized(link.target)));
  return context.nodes
    .map((node) => {
      const reasons: string[] = [];
      let confidence = 0;
      if (node.path === file.path) {
        confidence = Math.max(confidence, 0.96);
        reasons.push("历史来源路径完全一致");
      }
      if (normalized(node.title) === normalized(file.title)) {
        confidence = Math.max(confidence, 0.9);
        reasons.push("标题完全一致");
      }
      const pathTitle = file.path.split("/").at(-1) ?? file.path;
      if (normalized(node.title) === normalized(pathTitle)) {
        confidence = Math.max(confidence, 0.86);
        reasons.push("节点标题与文件名一致");
      }
      const overlap = termOverlap(node.title, `${file.title} ${file.path}`);
      if (overlap >= 0.2) {
        confidence = Math.max(confidence, Math.min(0.78, 0.35 + overlap * 0.5));
        reasons.push(`标题与路径词项重合 ${Math.round(overlap * 100)}%`);
      }
      const neighborIds = context.relations.flatMap((relation) =>
        relation.source === node.id ? [relation.target] : relation.target === node.id ? [relation.source] : [],
      );
      const matchedNeighbors = context.nodes.filter(
        (candidate) => neighborIds.includes(candidate.id) && linkedTitles.has(normalized(candidate.title)),
      );
      if (matchedNeighbors.length > 0) {
        confidence = Math.min(0.98, confidence + Math.min(0.16, matchedNeighbors.length * 0.08));
        reasons.push(`链接邻居吻合：${matchedNeighbors.map((candidate) => candidate.title).join("、")}`);
      }
      if (node.status === "missing-source" && confidence > 0) {
        confidence = Math.min(0.99, confidence + 0.03);
        reasons.push("该旧节点正处于来源缺失状态");
      }
      return { id: node.id, title: node.title, reason: reasons.join("；"), confidence };
    })
    .filter((candidate) => candidate.confidence >= 0.25)
    .sort((left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id))
    .slice(0, 5);
}

/** Mark bound nodes whose source disappeared or no longer declares their id. */
export function markMissingSources(snapshot: VaultSnapshot, indexed: IndexedFile[]): VaultSnapshot {
  const files = new Map(indexed.map((file) => [file.path, file]));
  let changed = false;
  const nodes = snapshot.nodes.map((node) => {
    if (!node.path || node.status === "frozen") return node;
    const file = files.get(node.path);
    const missing = !file || file.kbId !== node.id;
    if (missing && node.status !== "missing-source") {
      changed = true;
      return { ...node, status: "missing-source" as const };
    }
    if (!missing && node.status === "missing-source") {
      changed = true;
      return { ...node, status: "formal" as const };
    }
    return node;
  });
  return changed ? { ...snapshot, nodes } : snapshot;
}

export function toPending(
  indexed: IndexedFile[],
  knownIds: Set<string>,
  context?: Pick<VaultSnapshot, "nodes" | "relations">,
): PendingMention[] {
  const pending: PendingMention[] = [];
  for (const file of indexed) {
    if (!file.kbId || !knownIds.has(file.kbId)) {
      pending.push({
        id: `lineage:${file.path}`,
        filePath: file.path,
        targetTitle: file.title,
        kind: "lineage",
        raw: file.kbId
          ? `文件声明了未知 kb-id：${file.kbId}。系统不会自动绑定。`
          : "缺少 kb-id；候选仅依据路径、标题、词项和链接邻居生成，需用户确认。",
        candidates: lineageCandidates(file, context),
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
