import { runApprovedKnowledgeBridgeTools, runKnowledgeBridgeAgent } from "./agentRuntime";
import type { AiConnectionSettings } from "./aiSettings";
import { enforceCrossScaleGovernance, enforceFrozenL2Governance } from "./governance";
import { GraphLedger, type LedgerSideEffects, type LedgerUndoResult } from "./ledger";
import {
  applyKnowledgeGraphOperation,
  type AppliedKnowledgeGraphOperation,
  type KnowledgeGraphOperation,
} from "./operations";
import type { KnowledgeGraphOperationMeta, PaperBridgeDraft, VaultSnapshot } from "./model";

export interface KnowledgeBridgeCommit {
  snapshot: VaultSnapshot;
  kind: string;
  operation?: KnowledgeGraphOperationMeta;
  sideEffects?: LedgerSideEffects;
}

/**
 * The frontend-facing contract for the local Knowledge Bridge backend.
 *
 * This implementation is intentionally transport-free: it can run in the
 * Tauri WebView today, while a future Tauri-command or localhost-service
 * adapter can implement the exact same operations without changing the UI.
 */
export interface KnowledgeBridgeBackend {
  draft(
    input: string,
    snapshot: VaultSnapshot,
    connection: AiConnectionSettings,
    projectUri?: string,
  ): Promise<PaperBridgeDraft>;
  runApprovedTools(
    draft: PaperBridgeDraft,
    approvedRequestIds: string[],
    snapshot: VaultSnapshot,
    connection: AiConnectionSettings,
    projectUri?: string,
  ): Promise<PaperBridgeDraft>;
  /** Persist a user-visible ledger change as one undoable version. */
  commit(change: KnowledgeBridgeCommit): VaultSnapshot;
  /** Apply and persist a typed Agent/MCP/Skill/canvas operation exactly once. */
  applyOperation(
    snapshot: VaultSnapshot,
    operation: KnowledgeGraphOperation,
    sideEffects?: LedgerSideEffects,
  ): AppliedKnowledgeGraphOperation;
  undo(): VaultSnapshot | undefined;
  undoWithSideEffects(): LedgerUndoResult | undefined;
}

export class LocalKnowledgeBridgeBackend implements KnowledgeBridgeBackend {
  constructor(private readonly ledger: GraphLedger) {}

  draft(
    input: string,
    snapshot: VaultSnapshot,
    connection: AiConnectionSettings,
    projectUri?: string,
  ): Promise<PaperBridgeDraft> {
    return runKnowledgeBridgeAgent({ input, snapshot, connection, projectUri });
  }

  runApprovedTools(
    draft: PaperBridgeDraft,
    approvedRequestIds: string[],
    snapshot: VaultSnapshot,
    connection: AiConnectionSettings,
    projectUri?: string,
  ): Promise<PaperBridgeDraft> {
    return runApprovedKnowledgeBridgeTools({ draft, approvedRequestIds, snapshot, connection, projectUri });
  }

  commit(change: KnowledgeBridgeCommit): VaultSnapshot {
    const operation =
      change.operation ??
      ({
        id: `kb-operation:${crypto.randomUUID()}`,
        origin: "user",
        type: change.kind,
        createdAt: Date.now(),
      } satisfies KnowledgeGraphOperationMeta);
    const previous = this.ledger.load();
    let governed = enforceFrozenL2Governance(enforceCrossScaleGovernance(change.snapshot));
    if (change.kind !== "managed-link-restore") {
      const severedIds = new Set(
        previous.relations.filter((relation) => relation.status === "severed").map((relation) => relation.id),
      );
      if (severedIds.size > 0) {
        governed = {
          ...governed,
          relations: governed.relations.map((relation) =>
            severedIds.has(relation.id) ? { ...relation, status: "severed" as const } : relation,
          ),
        };
      }
    }
    this.ledger.save(governed, change.kind, operation, change.sideEffects);
    return governed;
  }

  applyOperation(
    snapshot: VaultSnapshot,
    operation: KnowledgeGraphOperation,
    sideEffects?: LedgerSideEffects,
  ): AppliedKnowledgeGraphOperation {
    const applied = applyKnowledgeGraphOperation(snapshot, operation);
    if (applied.changed) {
      const persisted = this.commit({
        snapshot: applied.snapshot,
        kind: applied.transactionKind,
        operation: applied.meta,
        sideEffects,
      });
      return { ...applied, snapshot: persisted };
    }
    return applied;
  }

  undo(): VaultSnapshot | undefined {
    return this.ledger.undo();
  }

  undoWithSideEffects(): LedgerUndoResult | undefined {
    return this.ledger.undoWithSideEffects();
  }
}
