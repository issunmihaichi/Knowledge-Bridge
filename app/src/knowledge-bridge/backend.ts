import { runApprovedKnowledgeBridgeTools, runKnowledgeBridgeAgent } from "./agentRuntime";
import type { AiConnectionSettings } from "./aiSettings";
import { GraphLedger } from "./ledger";
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
  applyOperation(snapshot: VaultSnapshot, operation: KnowledgeGraphOperation): AppliedKnowledgeGraphOperation;
  undo(): VaultSnapshot | undefined;
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
    this.ledger.save(change.snapshot, change.kind, operation);
    return change.snapshot;
  }

  applyOperation(snapshot: VaultSnapshot, operation: KnowledgeGraphOperation): AppliedKnowledgeGraphOperation {
    const applied = applyKnowledgeGraphOperation(snapshot, operation);
    if (applied.changed) {
      this.commit({
        snapshot: applied.snapshot,
        kind: applied.transactionKind,
        operation: applied.meta,
      });
    }
    return applied;
  }

  undo(): VaultSnapshot | undefined {
    return this.ledger.undo();
  }
}
