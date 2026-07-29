import { describe, expect, it } from "vitest";
import {
  collectVaultFiles,
  indexMarkdown,
  indexVaultIncrementally,
  syncChangedNodeSources,
  toPending,
  type IndexedFile,
} from "./indexer";
import { emptyVaultSnapshot } from "./model";
import { DemoVaultAdapter, type VaultAdapter } from "./vault";

describe("Knowledge Bridge vault indexing", () => {
  it("keeps scanned mentions and unresolved lineage in the pending pool", async () => {
    const controller = new AbortController();
    const progress: string[] = [];
    const files = await collectVaultFiles(new DemoVaultAdapter(), controller.signal, (item) =>
      progress.push(item.phase),
    );
    const indexed = await indexMarkdown(files, controller.signal, (item) => progress.push(item.phase));
    const pending = toPending(indexed, new Set(["dna", "expression"]));

    expect(indexed).toHaveLength(3);
    expect(pending.filter((item) => item.kind === "wikilink")).toHaveLength(2);
    expect(pending.find((item) => item.kind === "lineage")?.targetTitle).toBe("肿瘤细胞状态研究");
    expect(progress).toContain("complete");
  });

  it("honors cancellation before reading the Vault", async () => {
    const controller = new AbortController();
    controller.abort();
    const files = await collectVaultFiles(new DemoVaultAdapter(), controller.signal, () => undefined);
    expect(files).toEqual([]);
  });

  it("builds explainable lineage candidates without auto-binding them", () => {
    const pending = toPending(
      [
        {
          path: "Notes/遗失概念.md",
          title: "遗失概念",
          links: [],
          modifiedAt: 1,
          size: 10,
        },
      ],
      new Set(),
      {
        ...emptyVaultSnapshot,
        nodes: [
          {
            id: "old",
            title: "遗失概念",
            role: "L3",
            status: "missing-source",
            path: "Archive/遗失概念.md",
            content: "",
            x: 0,
            y: 0,
          },
        ],
      },
    );
    expect(pending[0]?.kind).toBe("lineage");
    expect(pending[0]?.candidates?.[0]).toEqual(
      expect.objectContaining({ id: "old", reason: expect.stringContaining("标题完全一致") }),
    );
  });

  it("reuses a 5000-file metadata cache without reading unchanged Markdown bodies", async () => {
    const count = 5_000;
    const cached: IndexedFile[] = Array.from({ length: count }, (_, index) => ({
      path: `Notes/note-${index}.md`,
      kbId: `node-${index}`,
      title: `Note ${index}`,
      links: [],
      modifiedAt: 10,
      size: 20,
    }));
    let bodyReads = 0;
    const adapter: VaultAdapter = {
      name: "large-vault",
      persistence: "vault",
      async *listMarkdownMetadata() {
        for (const file of cached) yield { path: file.path, modifiedAt: file.modifiedAt, size: file.size };
      },
      async *listMarkdown() {},
      async read() {
        bodyReads += 1;
        return "";
      },
      async write() {},
      async readBinary() {
        return undefined;
      },
      async writeBinary() {},
    };
    const result = await indexVaultIncrementally(adapter, cached, new AbortController().signal, () => undefined);
    expect(result.indexed).toHaveLength(count);
    expect(result.reusedCount).toBe(count);
    expect(result.changedFiles).toHaveLength(0);
    expect(bodyReads).toBe(0);
  });

  it("hydrates a bound editor from the Markdown body without exposing frontmatter", () => {
    const snapshot = structuredClone(emptyVaultSnapshot);
    snapshot.nodes.push({
      id: "bound",
      title: "Bound",
      role: "L3",
      status: "formal",
      path: "Notes/bound.md",
      content: "summary",
      x: 0,
      y: 0,
    });
    const content = "---\nkb-id: bound\ntags: [test]\n---\n\n# Bound\n\nActual note body";
    const next = syncChangedNodeSources(snapshot, [
      { path: "Notes/bound.md", content, modifiedAt: 1, size: content.length },
    ]);
    expect(next.nodes[0].detailsMarkdown).toBe("# Bound\n\nActual note body");
  });
});
