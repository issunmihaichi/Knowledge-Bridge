import initSqlJs, { type Database } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import type {
  BridgeModule,
  KnowledgeGraphOperationMeta,
  KnowledgeRelation,
  ManagedLinkSnapshot,
  VaultSnapshot,
} from "./model";

const DB_KEY = "knowledge-bridge.graph.db";

export interface LedgerSideEffects {
  upsertLinkSnapshots?: ManagedLinkSnapshot[];
  deleteLinkSnapshotIds?: string[];
  fileWrites?: Array<{ path: string; before: string; after: string }>;
}

export interface LedgerUndoResult {
  snapshot: VaultSnapshot;
  fileRestores: Array<{ path: string; content: string }>;
}

export function resolveSqlWasmPath(url: string, currentDirectory: string): string {
  const decoded = decodeURIComponent(url);
  if (decoded.startsWith("/@fs/")) return decoded.slice("/@fs/".length);
  if (decoded.startsWith("/")) return `${currentDirectory}${decoded}`;
  return decoded;
}

function locateWasm(): string {
  if (typeof window === "undefined") return resolveSqlWasmPath(wasmUrl, process.cwd());
  return wasmUrl;
}

function rows<T>(db: Database, query: string): T[] {
  const result = db.exec(query)[0];
  if (!result) return [];
  return result.values.map((values) =>
    Object.fromEntries(result.columns.map((column, index) => [column, values[index]])),
  ) as T[];
}

function normalizeRelation(relation: KnowledgeRelation): KnowledgeRelation {
  // Keep ledgers written by the earlier relation taxonomy readable.
  const legacyKind = relation.kind as string | undefined;
  if (legacyKind === "argument") {
    return { ...relation, kind: "structure", reasoningKind: relation.reasoningKind ?? "argument" };
  }
  if (legacyKind === "cross-scale" || legacyKind === "cross-scale-observation") {
    return {
      ...relation,
      kind: "causality",
      reasoningKind: relation.reasoningKind ?? "cross-scale",
      status: legacyKind === "cross-scale-observation" && relation.status === "formal" ? "pending" : relation.status,
    };
  }
  return relation;
}

function normalizeSnapshot(snapshot: VaultSnapshot): VaultSnapshot {
  return {
    ...snapshot,
    relations: snapshot.relations.map(normalizeRelation),
    lenses: snapshot.lenses ?? [],
    argumentRoles: snapshot.argumentRoles ?? [],
    migrationRecords: snapshot.migrationRecords ?? [],
    paperDrafts: snapshot.paperDrafts ?? [],
    graphProposals: snapshot.graphProposals ?? [],
  };
}

/** Versioned SQLite ledger. Markdown is edited by users; this ledger owns formal graph state and history. */
export class GraphLedger {
  private constructor(
    private readonly db: Database,
    private readonly externalPersist?: (bytes: Uint8Array) => Promise<void>,
    private readonly useBrowserCache = true,
  ) {}

  static async open(
    bytes?: Uint8Array,
    externalPersist?: (bytes: Uint8Array) => Promise<void>,
    useBrowserCache = true,
  ): Promise<GraphLedger> {
    const SQL = await initSqlJs({ locateFile: locateWasm });
    const stored =
      !bytes && useBrowserCache && typeof localStorage !== "undefined" ? localStorage.getItem(DB_KEY) : null;
    const initial =
      bytes ?? (stored ? Uint8Array.from(atob(stored), (character) => character.charCodeAt(0)) : undefined);
    const ledger = new GraphLedger(new SQL.Database(initial), externalPersist, useBrowserCache);
    ledger.migrate();
    return ledger;
  }

  private migrate() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS relations (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS link_snapshots (edge_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pending_items (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS scale_protocols (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS knowledge_lenses (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS argument_roles (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS migration_records (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS paper_drafts (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS graph_proposals (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bridge_modules (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, undone_at INTEGER);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  load(): VaultSnapshot {
    const nodes = rows<{ payload: string }>(this.db, "SELECT payload FROM nodes").map((row) => JSON.parse(row.payload));
    const relations = rows<{ payload: string }>(this.db, "SELECT payload FROM relations").map((row) =>
      JSON.parse(row.payload),
    );
    const pending = rows<{ payload: string }>(this.db, "SELECT payload FROM pending_items").map((row) =>
      JSON.parse(row.payload),
    );
    const protocols = rows<{ payload: string }>(this.db, "SELECT payload FROM scale_protocols").map((row) =>
      JSON.parse(row.payload),
    );
    const lenses = rows<{ payload: string }>(this.db, "SELECT payload FROM knowledge_lenses").map((row) =>
      JSON.parse(row.payload),
    );
    const argumentRoles = rows<{ payload: string }>(this.db, "SELECT payload FROM argument_roles").map((row) =>
      JSON.parse(row.payload),
    );
    const migrationRecords = rows<{ payload: string }>(this.db, "SELECT payload FROM migration_records").map((row) =>
      JSON.parse(row.payload),
    );
    const paperDrafts = rows<{ payload: string }>(this.db, "SELECT payload FROM paper_drafts").map((row) =>
      JSON.parse(row.payload),
    );
    const graphProposals = rows<{ payload: string }>(this.db, "SELECT payload FROM graph_proposals").map((row) =>
      JSON.parse(row.payload),
    );
    const bridgeModules = rows<{ payload: string }>(this.db, "SELECT payload FROM bridge_modules").map((row) =>
      JSON.parse(row.payload),
    ) as BridgeModule[];
    return normalizeSnapshot({
      nodes,
      relations,
      pending,
      protocols,
      lenses,
      argumentRoles,
      migrationRecords,
      paperDrafts,
      graphProposals,
      ...(bridgeModules.length > 0 ? { bridgeModules } : {}),
    });
  }

  save(
    snapshot: VaultSnapshot,
    kind = "graph-save",
    operation?: KnowledgeGraphOperationMeta,
    sideEffects: LedgerSideEffects = {},
  ) {
    const before = this.load();
    snapshot = normalizeSnapshot(snapshot);
    const affectedLinkIds = [
      ...new Set([
        ...(sideEffects.deleteLinkSnapshotIds ?? []),
        ...(sideEffects.upsertLinkSnapshots ?? []).map((item) => item.edgeId),
      ]),
    ];
    const linkSnapshotsBefore = affectedLinkIds.map((edgeId) => ({
      edgeId,
      snapshot: this.getSnapshot(edgeId) ?? null,
    }));
    this.db.run("BEGIN");
    try {
      this.db.run(
        "DELETE FROM nodes; DELETE FROM relations; DELETE FROM pending_items; DELETE FROM scale_protocols; DELETE FROM knowledge_lenses; DELETE FROM argument_roles; DELETE FROM migration_records; DELETE FROM paper_drafts; DELETE FROM graph_proposals; DELETE FROM bridge_modules;",
      );
      for (const node of snapshot.nodes)
        this.db.run("INSERT INTO nodes VALUES (?, ?)", [node.id, JSON.stringify(node)]);
      for (const relation of snapshot.relations)
        this.db.run("INSERT INTO relations VALUES (?, ?)", [relation.id, JSON.stringify(relation)]);
      for (const pending of snapshot.pending)
        this.db.run("INSERT INTO pending_items VALUES (?, ?)", [pending.id, JSON.stringify(pending)]);
      for (const protocol of snapshot.protocols)
        this.db.run("INSERT INTO scale_protocols VALUES (?, ?)", [protocol.id, JSON.stringify(protocol)]);
      for (const lens of snapshot.lenses)
        this.db.run("INSERT INTO knowledge_lenses VALUES (?, ?)", [lens.id, JSON.stringify(lens)]);
      for (const role of snapshot.argumentRoles)
        this.db.run("INSERT INTO argument_roles VALUES (?, ?)", [role.id, JSON.stringify(role)]);
      for (const record of snapshot.migrationRecords)
        this.db.run("INSERT INTO migration_records VALUES (?, ?)", [record.id, JSON.stringify(record)]);
      for (const draft of snapshot.paperDrafts)
        this.db.run("INSERT INTO paper_drafts VALUES (?, ?)", [draft.id, JSON.stringify(draft)]);
      for (const proposal of snapshot.graphProposals)
        this.db.run("INSERT INTO graph_proposals VALUES (?, ?)", [proposal.id, JSON.stringify(proposal)]);
      for (const module of snapshot.bridgeModules ?? [])
        this.db.run("INSERT INTO bridge_modules VALUES (?, ?)", [module.id, JSON.stringify(module)]);
      for (const edgeId of sideEffects.deleteLinkSnapshotIds ?? []) {
        this.db.run("DELETE FROM link_snapshots WHERE edge_id = ?", [edgeId]);
      }
      for (const linkSnapshot of sideEffects.upsertLinkSnapshots ?? []) {
        this.db.run("INSERT OR REPLACE INTO link_snapshots VALUES (?, ?)", [
          linkSnapshot.edgeId,
          JSON.stringify(linkSnapshot),
        ]);
      }
      const linkSnapshotsAfter = affectedLinkIds.map((edgeId) => ({
        edgeId,
        snapshot: this.getSnapshot(edgeId) ?? null,
      }));
      this.db.run("INSERT INTO transactions(kind, payload, created_at) VALUES (?, ?, ?)", [
        kind,
        JSON.stringify({
          before,
          after: snapshot,
          operation,
          linkSnapshotsBefore,
          linkSnapshotsAfter,
          fileWrites: sideEffects.fileWrites ?? [],
        }),
        Date.now(),
      ]);
      this.db.run("COMMIT");
      this.flush();
    } catch (error) {
      this.db.run("ROLLBACK");
      throw error;
    }
  }

  saveSnapshot(snapshot: ManagedLinkSnapshot) {
    this.db.run("INSERT OR REPLACE INTO link_snapshots VALUES (?, ?)", [snapshot.edgeId, JSON.stringify(snapshot)]);
    this.flush();
  }

  getSnapshot(edgeId: string): ManagedLinkSnapshot | undefined {
    const statement = this.db.prepare("SELECT payload FROM link_snapshots WHERE edge_id = ?");
    statement.bind([edgeId]);
    const value = statement.step()
      ? (JSON.parse(String(statement.getAsObject().payload)) as ManagedLinkSnapshot)
      : undefined;
    statement.free();
    return value;
  }

  listSnapshots(): ManagedLinkSnapshot[] {
    return rows<{ payload: string }>(this.db, "SELECT payload FROM link_snapshots ORDER BY edge_id").map((row) =>
      JSON.parse(row.payload),
    );
  }

  getMetadata<T>(key: string): T | undefined {
    const statement = this.db.prepare("SELECT value FROM metadata WHERE key = ?");
    statement.bind([key]);
    const value = statement.step() ? (JSON.parse(String(statement.getAsObject().value)) as T) : undefined;
    statement.free();
    return value;
  }

  /** Rebuildable cache metadata is persisted without creating an undo version. */
  setMetadata<T>(key: string, value: T): void {
    this.db.run("INSERT OR REPLACE INTO metadata VALUES (?, ?)", [key, JSON.stringify(value)]);
    this.flush();
  }

  undoWithSideEffects(): LedgerUndoResult | undefined {
    const transaction = rows<{ id: number; payload: string }>(
      this.db,
      "SELECT id, payload FROM transactions WHERE undone_at IS NULL ORDER BY id DESC LIMIT 1",
    )[0];
    if (!transaction) return undefined;
    const payload = JSON.parse(transaction.payload) as {
      before: VaultSnapshot;
      linkSnapshotsBefore?: Array<{ edgeId: string; snapshot: ManagedLinkSnapshot | null }>;
      fileWrites?: Array<{ path: string; before: string; after: string }>;
    };
    const before = normalizeSnapshot(payload.before);
    this.db.run("UPDATE transactions SET undone_at = ? WHERE id = ?", [Date.now(), transaction.id]);
    this.replace(before);
    for (const record of payload.linkSnapshotsBefore ?? []) {
      this.db.run("DELETE FROM link_snapshots WHERE edge_id = ?", [record.edgeId]);
      if (record.snapshot) {
        this.db.run("INSERT INTO link_snapshots VALUES (?, ?)", [record.edgeId, JSON.stringify(record.snapshot)]);
      }
    }
    this.flush();
    return {
      snapshot: before,
      fileRestores: (payload.fileWrites ?? []).map((write) => ({ path: write.path, content: write.before })),
    };
  }

  undo(): VaultSnapshot | undefined {
    return this.undoWithSideEffects()?.snapshot;
  }

  exportBytes() {
    return this.db.export();
  }

  private replace(snapshot: VaultSnapshot) {
    snapshot = normalizeSnapshot(snapshot);
    this.db.run(
      "DELETE FROM nodes; DELETE FROM relations; DELETE FROM pending_items; DELETE FROM scale_protocols; DELETE FROM knowledge_lenses; DELETE FROM argument_roles; DELETE FROM migration_records; DELETE FROM paper_drafts; DELETE FROM graph_proposals; DELETE FROM bridge_modules;",
    );
    for (const node of snapshot.nodes) this.db.run("INSERT INTO nodes VALUES (?, ?)", [node.id, JSON.stringify(node)]);
    for (const relation of snapshot.relations)
      this.db.run("INSERT INTO relations VALUES (?, ?)", [relation.id, JSON.stringify(relation)]);
    for (const pending of snapshot.pending)
      this.db.run("INSERT INTO pending_items VALUES (?, ?)", [pending.id, JSON.stringify(pending)]);
    for (const protocol of snapshot.protocols)
      this.db.run("INSERT INTO scale_protocols VALUES (?, ?)", [protocol.id, JSON.stringify(protocol)]);
    for (const lens of snapshot.lenses)
      this.db.run("INSERT INTO knowledge_lenses VALUES (?, ?)", [lens.id, JSON.stringify(lens)]);
    for (const role of snapshot.argumentRoles)
      this.db.run("INSERT INTO argument_roles VALUES (?, ?)", [role.id, JSON.stringify(role)]);
    for (const record of snapshot.migrationRecords)
      this.db.run("INSERT INTO migration_records VALUES (?, ?)", [record.id, JSON.stringify(record)]);
    for (const draft of snapshot.paperDrafts)
      this.db.run("INSERT INTO paper_drafts VALUES (?, ?)", [draft.id, JSON.stringify(draft)]);
    for (const proposal of snapshot.graphProposals)
      this.db.run("INSERT INTO graph_proposals VALUES (?, ?)", [proposal.id, JSON.stringify(proposal)]);
    for (const module of snapshot.bridgeModules ?? [])
      this.db.run("INSERT INTO bridge_modules VALUES (?, ?)", [module.id, JSON.stringify(module)]);
  }

  private flush() {
    const binary = this.db.export();
    if (this.useBrowserCache && typeof localStorage !== "undefined") {
      let encoded = "";
      for (const byte of binary) encoded += String.fromCharCode(byte);
      localStorage.setItem(DB_KEY, btoa(encoded));
    }
    void this.externalPersist?.(binary);
  }
}
