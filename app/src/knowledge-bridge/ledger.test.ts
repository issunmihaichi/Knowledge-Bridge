import { describe, expect, it } from "vitest";
import { demoVaultSnapshot, type VaultSnapshot } from "./model";
import { GraphLedger } from "./ledger";

describe("Knowledge Bridge graph ledger", () => {
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
    const changed: VaultSnapshot = {
      ...structuredClone(initial),
      pending: [],
      protocols: initial.protocols.map((protocol) => ({ ...protocol, status: "gap" })),
    };

    ledger.save(initial, "initial");
    ledger.save(changed, "change");
    expect(ledger.load()).toEqual(changed);
    expect(ledger.undo()).toEqual(initial);
    expect(ledger.load()).toEqual(initial);
    expect(persisted.length).toBeGreaterThan(0);
  });
});
