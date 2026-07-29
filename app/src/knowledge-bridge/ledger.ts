import initSqlJs, { type Database } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import type { KnowledgeRelation, ManagedLinkSnapshot, VaultSnapshot } from "./model";

const DB_KEY = "knowledge-bridge.graph.db";

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
    });
  }

  save(snapshot: VaultSnapshot, kind = "graph-save") {
    const before = this.load();
    snapshot = normalizeSnapshot(snapshot);
    this.db.run("BEGIN");
    try {
      this.db.run(
        "DELETE FROM nodes; DELETE FROM relations; DELETE FROM pending_items; DELETE FROM scale_protocols; DELETE FROM knowledge_lenses; DELETE FROM argument_roles; DELETE FROM migration_records; DELETE FROM paper_drafts; DELETE FROM graph_proposals;",
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
      this.db.run("INSERT INTO transactions(kind, payload, created_at) VALUES (?, ?, ?)", [
        kind,
        JSON.stringify({ before, after: snapshot }),
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

  undo(): VaultSnapshot | undefined {
    const transaction = rows<{ id: number; payload: string }>(
      this.db,
      "SELECT id, payload FROM transactions WHERE undone_at IS NULL ORDER BY id DESC LIMIT 1",
    )[0];
    if (!transaction) return undefined;
    const before = normalizeSnapshot(JSON.parse(transaction.payload).before as VaultSnapshot);
    this.db.run("UPDATE transactions SET undone_at = ? WHERE id = ?", [Date.now(), transaction.id]);
    this.replace(before);
    this.flush();
    return before;
  }

  exportBytes() {
    return this.db.export();
  }

  private replace(snapshot: VaultSnapshot) {
    snapshot = normalizeSnapshot(snapshot);
    this.db.run(
      "DELETE FROM nodes; DELETE FROM relations; DELETE FROM pending_items; DELETE FROM scale_protocols; DELETE FROM knowledge_lenses; DELETE FROM argument_roles; DELETE FROM migration_records; DELETE FROM paper_drafts; DELETE FROM graph_proposals;",
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
