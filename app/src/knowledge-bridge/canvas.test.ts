import { describe, expect, it } from "vitest";
import { shouldApplyLedgerPosition } from "./canvasPosition";

describe("Knowledge Bridge canvas synchronization", () => {
  it("does not overwrite a canvas drag that has not yet been persisted", () => {
    expect(shouldApplyLedgerPosition({ x: 100, y: 100 }, { x: 160, y: 100 }, { x: 100, y: 100 })).toBe(false);
  });

  it("uses a ledger coordinate when a committed operation changed it", () => {
    expect(shouldApplyLedgerPosition({ x: 160, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 100 })).toBe(true);
  });

  it("places a newly materialized managed node at its ledger coordinate", () => {
    expect(shouldApplyLedgerPosition({ x: 10, y: 20 }, { x: 0, y: 0 }, undefined)).toBe(true);
  });
});
