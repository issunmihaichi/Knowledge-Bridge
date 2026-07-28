import { describe, expect, it } from "vitest";
import { appendManagedLink, parseLinks, reconcileManagedLink, upsertKbId } from "./sync";

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
});
