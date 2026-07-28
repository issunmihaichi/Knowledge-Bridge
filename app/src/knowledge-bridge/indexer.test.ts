import { describe, expect, it } from "vitest";
import { collectVaultFiles, indexMarkdown, toPending } from "./indexer";
import { DemoVaultAdapter } from "./vault";

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
});
