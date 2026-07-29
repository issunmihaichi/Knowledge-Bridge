import type { KnowledgeRelation, ManagedLinkSnapshot, PendingMention, VaultFile, VaultSnapshot } from "./model";
import type { VaultAdapter } from "./vault";

export const MANAGED_LINK_PATTERN = /\[\[([^\]]+)\]\]\s*<!--\s*kb-link:([\w-]+)\s*-->/g;
export const WIKILINK_PATTERN = /\[\[([^\]]+)\]\]/g;

export interface ParsedLink {
  target: string;
  edgeId?: string;
  raw: string;
  index: number;
}

export interface MarkdownDocumentParts {
  frontmatter?: string;
  body: string;
}

export type SyncDecision =
  | { kind: "self-write" }
  | { kind: "unchanged" }
  | { kind: "severed"; edgeId: string; remainingTarget?: string }
  | { kind: "retargeted"; edgeId: string; oldTarget: string; newTarget: string };

export function splitMarkdownDocument(content: string): MarkdownDocumentParts {
  const frontmatter = content.match(/^---[^\S\r\n]*(?:\r\n|\n)[\s\S]*?(?:\r\n|\n)---[^\S\r\n]*(?=\r?\n|$)/)?.[0];
  if (!frontmatter) return { body: content };
  return {
    frontmatter,
    body: content.slice(frontmatter.length).replace(/^(?:\r?\n)+/, ""),
  };
}

export function markdownBody(content: string): string {
  return splitMarkdownDocument(content).body;
}

export function parseKbId(content: string): string | undefined {
  const frontmatter = splitMarkdownDocument(content).frontmatter;
  return frontmatter?.match(/^kb-id:\s*['"]?([^'"\r\n]+)['"]?\s*$/m)?.[1].trim();
}

export function parseTitle(content: string, path: string): string {
  const heading = markdownBody(content)
    .match(/^#\s+(.+)$/m)?.[1]
    ?.trim();
  if (heading) return heading;
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.md$/i, "");
}

export function parseLinks(content: string): ParsedLink[] {
  const managedRanges: Array<[number, number]> = [];
  const links: ParsedLink[] = [];
  for (const match of content.matchAll(MANAGED_LINK_PATTERN)) {
    managedRanges.push([match.index, match.index + match[0].length]);
    links.push({ target: match[1].trim(), edgeId: match[2], raw: match[0], index: match.index });
  }
  for (const match of content.matchAll(WIKILINK_PATTERN)) {
    if (managedRanges.some(([start, end]) => match.index >= start && match.index < end)) continue;
    links.push({ target: match[1].trim(), raw: match[0], index: match.index });
  }
  return links.sort((left, right) => left.index - right.index);
}

export function appendManagedLink(content: string, target: string, edgeId: string): string {
  const suffix = content.endsWith("\n") ? "" : "\n";
  return `${content}${suffix}\n[[${target}]] <!-- kb-link:${edgeId} -->\n`;
}

export function upsertKbId(content: string, id: string): string {
  if (parseKbId(content)) return content;
  const { frontmatter } = splitMarkdownDocument(content);
  if (frontmatter) {
    return content.replace(/^---[^\S\r\n]*(\r?\n)/, (opening, lineBreak: string) => {
      return `${opening}kb-id: ${id}${lineBreak}`;
    });
  }
  const lineBreak = content.includes("\r\n") ? "\r\n" : "\n";
  return `---${lineBreak}kb-id: ${id}${lineBreak}---${lineBreak}${lineBreak}${content}`;
}

/** Replace only the editor-visible body while preserving all Vault properties. */
export function mergeMarkdownBody(content: string, body: string, id: string): string {
  const withId = upsertKbId(content, id);
  const { frontmatter } = splitMarkdownDocument(withId);
  if (!frontmatter) return withId;
  const lineBreak = frontmatter.includes("\r\n") ? "\r\n" : "\n";
  const normalizedBody = body.replace(/^(?:\r?\n)+/, "");
  return normalizedBody ? `${frontmatter}${lineBreak}${lineBreak}${normalizedBody}` : `${frontmatter}${lineBreak}`;
}

export async function contentHash(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function reconcileManagedLink(content: string, snapshot: ManagedLinkSnapshot): Promise<SyncDecision> {
  if ((await contentHash(content)) === snapshot.afterHash) return { kind: "self-write" };
  const links = parseLinks(content);
  const managed = links.find((link) => link.edgeId === snapshot.edgeId);
  if (managed?.target === snapshot.target) return { kind: "unchanged" };
  if (managed) {
    return { kind: "retargeted", edgeId: snapshot.edgeId, oldTarget: snapshot.target, newTarget: managed.target };
  }
  const unmarked = links.find((link) => !link.edgeId && link.target === snapshot.target);
  return { kind: "severed", edgeId: snapshot.edgeId, remainingTarget: unmarked?.target };
}

export function severRelation(relations: KnowledgeRelation[], edgeId: string): KnowledgeRelation[] {
  return relations.map((relation) => (relation.id === edgeId ? { ...relation, status: "severed" as const } : relation));
}

export interface ManagedLinkReconciliation {
  snapshot: VaultSnapshot;
  deleteLinkSnapshotIds: string[];
  decisions: Array<{ edgeId: string; decision: SyncDecision }>;
}

function pendingFromManagedChange(
  managed: ManagedLinkSnapshot,
  target: string,
  raw: string,
  prefix: "unmarked" | "retargeted",
): PendingMention {
  return {
    id: `${prefix}:${managed.edgeId}:${target}`,
    filePath: managed.filePath,
    sourceId: managed.fileId,
    targetTitle: target,
    kind: "wikilink",
    raw,
  };
}

/**
 * Apply managed-link edits observed during a real Vault scan. Destructive user
 * edits sever or historicize the managed edge and can never trigger a rewrite.
 */
export async function reconcileVaultManagedLinks(
  snapshot: VaultSnapshot,
  files: VaultFile[],
  managedSnapshots: ManagedLinkSnapshot[],
): Promise<ManagedLinkReconciliation> {
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  let relations = snapshot.relations;
  let pending = snapshot.pending;
  const deleteLinkSnapshotIds: string[] = [];
  const decisions: ManagedLinkReconciliation["decisions"] = [];

  for (const managed of managedSnapshots) {
    const content = filesByPath.get(managed.filePath)?.content ?? "";
    const decision = await reconcileManagedLink(content, managed);
    decisions.push({ edgeId: managed.edgeId, decision });
    if (decision.kind === "self-write" || decision.kind === "unchanged") continue;

    deleteLinkSnapshotIds.push(managed.edgeId);
    if (decision.kind === "retargeted") {
      relations = relations.map((relation) =>
        relation.id === managed.edgeId
          ? {
              ...relation,
              status: "historical" as const,
              managedFilePath: managed.filePath,
              managedTarget: managed.target,
            }
          : relation,
      );
      const item = pendingFromManagedChange(
        managed,
        decision.newTarget,
        `[[${decision.newTarget}]] <!-- 原托管边 ${managed.edgeId} 已转入历史层 -->`,
        "retargeted",
      );
      if (!pending.some((existing) => existing.id === item.id)) pending = [...pending, item];
      continue;
    }

    relations = severRelation(relations, managed.edgeId).map((relation) =>
      relation.id === managed.edgeId
        ? { ...relation, managedFilePath: managed.filePath, managedTarget: managed.target }
        : relation,
    );
    const severedItem: PendingMention = {
      id: `severed-link:${managed.edgeId}`,
      filePath: managed.filePath,
      sourceId: managed.fileId,
      relationId: managed.edgeId,
      targetTitle: managed.target,
      kind: "severed-link",
      raw: "该托管双链被用户手动剪断；系统不会自动恢复。",
    };
    if (!pending.some((existing) => existing.id === severedItem.id)) pending = [...pending, severedItem];
    if (decision.remainingTarget) {
      const item = pendingFromManagedChange(
        managed,
        decision.remainingTarget,
        `[[${decision.remainingTarget}]]`,
        "unmarked",
      );
      if (!pending.some((existing) => existing.id === item.id)) pending = [...pending, item];
    }
  }

  const changed = relations !== snapshot.relations || pending !== snapshot.pending;
  return {
    snapshot: changed ? { ...snapshot, relations, pending } : snapshot,
    deleteLinkSnapshotIds,
    decisions,
  };
}

export interface PreparedManagedLinkWrite {
  snapshot: VaultSnapshot;
  linkSnapshot: ManagedLinkSnapshot;
  fileWrite: { path: string; before: string; after: string };
}

/** Prepare an explicit user-requested managed write and its atomic ledger side effect. */
export async function prepareManagedLinkWrite(
  adapter: VaultAdapter,
  snapshot: VaultSnapshot,
  relationId: string,
  filePath: string,
  target: string,
  now = Date.now(),
): Promise<PreparedManagedLinkWrite> {
  const relation = snapshot.relations.find((item) => item.id === relationId);
  if (!relation) throw new Error(`Relation ${relationId} does not exist.`);
  const before = await adapter.read(filePath);
  const fileId = parseKbId(before);
  if (!fileId) throw new Error("The source file needs a stable kb-id before a managed link can be written.");
  if (fileId !== relation.source) {
    throw new Error(`The source file belongs to ${fileId}, not relation source ${relation.source}.`);
  }
  const links = parseLinks(before);
  const existing = links.find((link) => link.edgeId === relationId);
  const ordinary = links.find((link) => !link.edgeId && link.target === target);
  const after =
    existing?.target === target
      ? before
      : ordinary
        ? `${before.slice(0, ordinary.index)}${ordinary.raw} <!-- kb-link:${relationId} -->${before.slice(ordinary.index + ordinary.raw.length)}`
        : appendManagedLink(before, target, relationId);
  if (after !== before) await adapter.write(filePath, after);
  const linkSnapshot: ManagedLinkSnapshot = {
    edgeId: relationId,
    fileId,
    filePath,
    target,
    beforeHash: await contentHash(before),
    afterHash: await contentHash(after),
    writtenAt: now,
  };
  return {
    snapshot: {
      ...snapshot,
      relations: snapshot.relations.map((item) =>
        item.id === relationId
          ? {
              ...item,
              managed: true,
              managedFilePath: filePath,
              managedTarget: target,
              status: item.status === "severed" ? "pending" : item.status,
            }
          : item,
      ),
    },
    linkSnapshot,
    fileWrite: { path: filePath, before, after },
  };
}
