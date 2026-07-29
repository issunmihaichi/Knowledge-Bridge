import { describe, expect, it } from "vitest";
import { createGraphChangeProposal } from "./graphProposal";
import { demoVaultSnapshot, type VaultSnapshot } from "./model";
import { draftPaperBridgeLocally } from "./paperBridgeAi";
import { GraphLedger, resolveSqlWasmPath } from "./ledger";

describe("Knowledge Bridge graph ledger", () => {
  it("resolves Vite file-system URLs on Windows without prefixing the app directory", () => {
    expect(resolveSqlWasmPath("/@fs/C:/Knowledge%20Bridge/sql-wasm.wasm", "C:/Knowledge Bridge/app")).toBe(
      "C:/Knowledge Bridge/sql-wasm.wasm",
    );
  });

  it("can restore a ledger written through a Vault persistence callback", async () => {
    const written: Uint8Array[] = [];
    const ledger = await GraphLedger.open(
      undefined,
      async (bytes) => {
        written.push(bytes.slice());
      },
      false,
    );
    const snapshot = structuredClone(demoVaultSnapshot);

    ledger.save(snapshot, "vault-create");

    expect(written).toHaveLength(1);
    const restored = await GraphLedger.open(written[0], undefined, false);
    expect(restored.load()).toEqual(snapshot);
  });

  it("restores pending items and scale protocols during undo", async () => {
    const persisted: Uint8Array[] = [];
    const ledger = await GraphLedger.open(undefined, async (bytes) => {
      persisted.push(bytes);
    });
    const initial = structuredClone(demoVaultSnapshot);
    const proposal = createGraphChangeProposal(
      draftPaperBridgeLocally("A frontier concept", initial, 1),
      initial,
      2,
      "ledger-proposal",
    );
    const changed: VaultSnapshot = {
      ...structuredClone(initial),
      pending: [],
      protocols: initial.protocols.map((protocol) => ({ ...protocol, status: "gap" })),
      graphProposals: [proposal],
    };

    ledger.save(initial, "initial");
    ledger.save(changed, "change");
    expect(ledger.load()).toEqual(changed);
    expect(ledger.load().graphProposals).toEqual([proposal]);
    expect(ledger.undo()).toEqual(initial);
    expect(ledger.load()).toEqual(initial);
    expect(persisted.length).toBeGreaterThan(0);
  });

  it("returns Markdown file restoration data with an undone editor transaction", async () => {
    const ledger = await GraphLedger.open(undefined, undefined, false);
    const initial = structuredClone(demoVaultSnapshot);
    const changed = structuredClone(initial);
    changed.nodes[0].detailsMarkdown = "# Edited";
    ledger.save(initial, "initial");
    ledger.save(changed, "node-details", undefined, {
      fileWrites: [{ path: "Notes/cell.md", before: "# Before", after: "# Edited" }],
    });
    expect(ledger.undoWithSideEffects()).toEqual({
      snapshot: initial,
      fileRestores: [{ path: "Notes/cell.md", content: "# Before" }],
    });
  });
});
