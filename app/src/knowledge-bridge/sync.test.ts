import { describe, expect, it } from "vitest";
import { GraphLedger } from "./ledger";
import { emptyVaultSnapshot, type VaultFile } from "./model";
import {
  appendManagedLink,
  markdownBody,
  mergeMarkdownBody,
  parseKbId,
  parseLinks,
  prepareManagedLinkWrite,
  reconcileManagedLink,
  reconcileVaultManagedLinks,
  upsertKbId,
} from "./sync";
import { DemoVaultAdapter } from "./vault";

describe("Knowledge Bridge managed links", () => {
  it("keeps managed and ordinary wikilinks distinct", () => {
    const content = appendManagedLink("# Note\n\n[[ordinary]]", "中心法则", "edge_01");
    expect(parseLinks(content).map(({ target, edgeId, raw }) => ({ target, edgeId, raw }))).toEqual([
      { target: "ordinary", edgeId: undefined, raw: "[[ordinary]]" },
      { target: "中心法则", edgeId: "edge_01", raw: "[[中心法则]] <!-- kb-link:edge_01 -->" },
    ]);
  });

  it("treats deletion as severed and a changed target as a new candidate", async () => {
    const before = "# Note\n";
    const written = appendManagedLink(before, "中心法则", "edge_01");
    const snapshot = {
      edgeId: "edge_01",
      fileId: "file_01",
      filePath: "Notes/Note.md",
      target: "中心法则",
      beforeHash: "before",
      afterHash: await (async () => {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(written));
        return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      })(),
      writtenAt: Date.now(),
    };
    expect((await reconcileManagedLink(before, snapshot)).kind).toBe("severed");
    const retargeted = written.replace("中心法则", "CRISPR-Cas9");
    expect((await reconcileManagedLink(retargeted, snapshot)).kind).toBe("retargeted");
  });

  it("adds a stable identity without rewriting an existing frontmatter", () => {
    expect(upsertKbId("# Note", "node_01")).toContain("kb-id: node_01");
    expect(upsertKbId("---\nkb-id: old\n---\n# Note", "node_01")).toContain("kb-id: old");
  });

  it("preserves CRLF Vault properties while replacing only the editable body", () => {
    const original = "---\r\ntags:\r\n  - biology\r\n---\r\n\r\n# Old title\r\n\r\nOld body\r\n";
    const identified = upsertKbId(original, "node_01");
    expect(parseKbId(identified)).toBe("node_01");
    expect(identified).toContain("tags:\r\n  - biology");
    expect(identified.match(/^---/gm)).toHaveLength(2);

    const merged = mergeMarkdownBody(identified, "# New title\n\nNew body", "node_01");
    expect(merged).toContain("tags:\r\n  - biology");
    expect(merged).toContain("kb-id: node_01");
    expect(merged).not.toContain("Old body");
    expect(markdownBody(merged)).toBe("# New title\n\nNew body");
  });

  it("reconciles a real Vault edit through the ledger without restoring a severed edge", async () => {
    const adapter = new DemoVaultAdapter();
    const filePath = "Notes/managed-source.md";
    const original = "---\nkb-id: source\n---\n\n# Source\n";
    await adapter.write(filePath, original);
    const initial = {
      ...structuredClone(emptyVaultSnapshot),
      nodes: [
        { id: "source", title: "Source", role: "L1" as const, status: "formal" as const, content: "", x: 0, y: 0 },
        { id: "target", title: "Target", role: "L3" as const, status: "formal" as const, content: "", x: 1, y: 1 },
      ],
      relations: [
        {
          id: "edge-managed",
          source: "source",
          target: "target",
          label: "提及",
          layer: "cognitive" as const,
          cognitiveKind: "mention" as const,
          status: "formal" as const,
        },
      ],
    };
    const prepared = await prepareManagedLinkWrite(adapter, initial, "edge-managed", filePath, "Target", 20);
    const ledger = await GraphLedger.open(undefined, undefined, false);
    ledger.save(prepared.snapshot, "managed-write", undefined, { upsertLinkSnapshots: [prepared.linkSnapshot] });
    expect(ledger.listSnapshots()).toHaveLength(1);

    // The user deliberately deletes both the link and marker in Obsidian.
    await adapter.write(filePath, original);
    const files: VaultFile[] = [];
    for await (const file of adapter.listMarkdown()) files.push(file);
    const reconciled = await reconcileVaultManagedLinks(ledger.load(), files, ledger.listSnapshots());
    ledger.save(reconciled.snapshot, "managed-reconcile", undefined, {
      deleteLinkSnapshotIds: reconciled.deleteLinkSnapshotIds,
    });

    expect(ledger.load().relations.find((relation) => relation.id === "edge-managed")?.status).toBe("severed");
    expect(ledger.listSnapshots()).toEqual([]);
    const nextPass = await reconcileVaultManagedLinks(ledger.load(), files, ledger.listSnapshots());
    expect(nextPass.snapshot.relations.find((relation) => relation.id === "edge-managed")?.status).toBe("severed");
    expect(nextPass.decisions).toEqual([]);

    const restored = await prepareManagedLinkWrite(adapter, ledger.load(), "edge-managed", filePath, "Target", 30);
    ledger.save(restored.snapshot, "managed-link-restore", undefined, {
      upsertLinkSnapshots: [restored.linkSnapshot],
      fileWrites: [restored.fileWrite],
    });
    expect(ledger.load().relations.find((relation) => relation.id === "edge-managed")?.status).toBe("pending");
    expect(await adapter.read(filePath)).toContain("<!-- kb-link:edge-managed -->");
    expect(ledger.listSnapshots()).toHaveLength(1);

    const undone = ledger.undoWithSideEffects();
    expect(undone?.snapshot.relations.find((relation) => relation.id === "edge-managed")?.status).toBe("severed");
    expect(undone?.fileRestores).toEqual([{ path: filePath, content: original }]);
    for (const restore of undone?.fileRestores ?? []) await adapter.write(restore.path, restore.content);
    expect(await adapter.read(filePath)).toBe(original);
    expect(ledger.listSnapshots()).toHaveLength(0);
  });

  it("refuses to restore a managed edge into a file with a different stable identity", async () => {
    const adapter = new DemoVaultAdapter();
    const filePath = "Notes/replaced.md";
    await adapter.write(filePath, "---\nkb-id: replacement\n---\n\n# Replaced");
    const graph = {
      ...structuredClone(emptyVaultSnapshot),
      relations: [
        {
          id: "edge-stale",
          source: "original",
          target: "target",
          label: "提及",
          layer: "cognitive" as const,
          status: "severed" as const,
        },
      ],
    };
    await expect(prepareManagedLinkWrite(adapter, graph, "edge-stale", filePath, "Target")).rejects.toThrow(
      "not relation source",
    );
    expect(await adapter.read(filePath)).not.toContain("kb-link:edge-stale");
  });

  it("turns a removed marker into an ordinary pending mention", async () => {
    const content = "---\nkb-id: source\n---\n\n[[Target]]\n";
    const snapshot = {
      edgeId: "edge_02",
      fileId: "source",
      filePath: "Notes/source.md",
      target: "Target",
      beforeHash: "before",
      afterHash: "after",
      writtenAt: 1,
    };
    const graph = {
      ...structuredClone(emptyVaultSnapshot),
      relations: [
        {
          id: "edge_02",
          source: "source",
          target: "target",
          label: "提及",
          layer: "cognitive" as const,
          status: "formal" as const,
        },
      ],
    };
    const result = await reconcileVaultManagedLinks(
      graph,
      [{ path: "Notes/source.md", content, modifiedAt: 1, size: content.length }],
      [snapshot],
    );
    expect(result.snapshot.relations[0]?.status).toBe("severed");
    expect(result.snapshot.pending).toContainEqual(
      expect.objectContaining({ kind: "wikilink", sourceId: "source", targetTitle: "Target" }),
    );
  });
});
