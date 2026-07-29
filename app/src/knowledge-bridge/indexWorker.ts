import type { IndexedFile } from "./indexer";
import type { VaultFile } from "./model";
import { parseKbId, parseLinks, parseTitle } from "./sync";

type WorkerScope = {
  onmessage: ((event: MessageEvent<{ files: VaultFile[] }>) => void) | null;
  postMessage(message: { type: "progress"; current: number } | { type: "complete"; results: IndexedFile[] }): void;
};

const scope = globalThis as unknown as WorkerScope;

scope.onmessage = (event) => {
  const results: IndexedFile[] = [];
  for (const [index, file] of event.data.files.entries()) {
    results.push({
      path: file.path,
      kbId: parseKbId(file.content),
      title: parseTitle(file.content, file.path),
      links: parseLinks(file.content),
      modifiedAt: file.modifiedAt,
      size: file.size,
    });
    if ((index + 1) % 100 === 0) scope.postMessage({ type: "progress", current: index + 1 });
  }
  scope.postMessage({ type: "complete", results });
};
