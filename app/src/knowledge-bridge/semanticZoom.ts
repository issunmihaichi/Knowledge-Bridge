import { relationBundles } from "./governance";
import type { VaultSnapshot } from "./model";

const DETAIL_HIDE_SCALE = 0.28;
const DETAIL_FULL_SCALE = 0.48;

export interface SemanticZoomProjection {
  detailOpacity: number;
  hiddenNodeIds: Set<string>;
  aggregateCounts: Map<string, number>;
}

/** Pure projection: semantic zoom never writes or derives new coordinates. */
export function projectSemanticZoom(snapshot: VaultSnapshot, scale: number): SemanticZoomProjection {
  const detailOpacity = Math.max(0, Math.min(1, (scale - DETAIL_HIDE_SCALE) / (DETAIL_FULL_SCALE - DETAIL_HIDE_SCALE)));
  const detailIds = new Set(
    snapshot.nodes.filter((node) => node.role === "L3" || node.role === "L4").map((node) => node.id),
  );
  const hiddenNodeIds = detailOpacity === 0 ? detailIds : new Set<string>();
  const adjacency = new Map<string, Set<string>>();
  for (const bundle of relationBundles(snapshot)) {
    if (!bundle.primary) continue;
    const source = adjacency.get(bundle.primary.source) ?? new Set<string>();
    const target = adjacency.get(bundle.primary.target) ?? new Set<string>();
    source.add(bundle.primary.target);
    target.add(bundle.primary.source);
    adjacency.set(bundle.primary.source, source);
    adjacency.set(bundle.primary.target, target);
  }
  const aggregateCounts = new Map<string, number>();
  for (const node of snapshot.nodes) {
    if (node.role !== "L1" && node.role !== "L2") continue;
    const visited = new Set([node.id]);
    let frontier = [node.id];
    const details = new Set<string>();
    for (let depth = 0; depth < 2; depth += 1) {
      const next: string[] = [];
      for (const current of frontier) {
        for (const neighbor of adjacency.get(current) ?? []) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          if (detailIds.has(neighbor)) details.add(neighbor);
          next.push(neighbor);
        }
      }
      frontier = next;
    }
    aggregateCounts.set(node.id, details.size);
  }
  return { detailOpacity, hiddenNodeIds, aggregateCounts };
}
