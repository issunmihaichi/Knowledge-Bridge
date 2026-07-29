import type { KnowledgeNode } from "./model";

export interface SpatialViewport {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

export interface KnowledgeSpatialIndex {
  cellSize: number;
  buckets: Map<string, KnowledgeNode[]>;
}

function bucketKey(x: number, y: number, cellSize: number): string {
  return `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;
}

export function buildKnowledgeSpatialIndex(nodes: KnowledgeNode[], cellSize = 800): KnowledgeSpatialIndex {
  const buckets = new Map<string, KnowledgeNode[]>();
  for (const node of nodes) {
    const key = bucketKey(node.x, node.y, cellSize);
    const bucket = buckets.get(key) ?? [];
    bucket.push(node);
    buckets.set(key, bucket);
  }
  return { cellSize, buckets };
}

export function queryKnowledgeSpatialIndex(
  index: KnowledgeSpatialIndex,
  viewport: SpatialViewport,
  limit = 700,
): Set<string> {
  const padding = 0.8;
  const halfWidth = Math.max(600, viewport.width * (0.5 + padding));
  const halfHeight = Math.max(450, viewport.height * (0.5 + padding));
  const leftCell = Math.floor((viewport.centerX - halfWidth) / index.cellSize);
  const rightCell = Math.floor((viewport.centerX + halfWidth) / index.cellSize);
  const topCell = Math.floor((viewport.centerY - halfHeight) / index.cellSize);
  const bottomCell = Math.floor((viewport.centerY + halfHeight) / index.cellSize);
  const candidates: KnowledgeNode[] = [];
  for (let x = leftCell; x <= rightCell; x += 1) {
    for (let y = topCell; y <= bottomCell; y += 1) {
      candidates.push(...(index.buckets.get(`${x}:${y}`) ?? []));
    }
  }
  candidates.sort((left, right) => {
    const leftDistance = (left.x - viewport.centerX) ** 2 + (left.y - viewport.centerY) ** 2;
    const rightDistance = (right.x - viewport.centerX) ** 2 + (right.y - viewport.centerY) ** 2;
    return leftDistance - rightDistance || left.id.localeCompare(right.id);
  });
  return new Set(candidates.slice(0, limit).map((node) => node.id));
}
