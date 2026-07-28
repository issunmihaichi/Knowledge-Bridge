import initSqlJs, { type Database } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import type { ManagedLinkSnapshot, VaultSnapshot } from "./model";

const DB_KEY = "knowledge-bridge.graph.db";

function locateWasm(): string {
  if (typeof window === "undefined" && wasmUrl.startsWith("/")) return `${process.cwd()}${wasmUrl}`;
  return wasmUrl;
}

function rows<T>(db: Database, query: string): T[] {
  const result = db.exec(query)[0];
  if (!result) return [];
  return result.values.map((values) =>
    Object.fromEntries(result.columns.map((column, index) => [column, values[index]])),
  ) as T[];
}

/** Versioned SQLite ledger. Markdown is edited by users; this ledger owns formal graph state and history. */
export class GraphLedger {
  private constructor(
    private readonly db: Database,
    private readonly externalPersist?: (bytes: Uint8Array) => Promise<void>,
  ) {}

  static async open(bytes?: Uint8Array, externalPersist?: (bytes: Uint8Array) => Promise<void>): Promise<GraphLedger> {
    const SQL = await initSqlJs({ locateFile: locateWasm });
    const stored = !bytes && typeof localStorage !== "undefined" ? localStorage.getItem(DB_KEY) : null;
    const initial =
      bytes ?? (stored ? Uint8Array.from(atob(stored), (character) => character.charCodeAt(0)) : undefined);
    const ledger = new GraphLedger(new SQL.Database(initial), externalPersist);
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
    return { nodes, relations, pending, protocols };
  }

  save(snapshot: VaultSnapshot, kind = "graph-save") {
    const before = this.load();
    this.db.run("BEGIN");
    try {
      this.db.run("DELETE FROM nodes; DELETE FROM relations; DELETE FROM pending_items; DELETE FROM scale_protocols;");
      for (const node of snapshot.nodes)
        this.db.run("INSERT INTO nodes VALUES (?, ?)", [node.id, JSON.stringify(node)]);
      for (const relation of snapshot.relations)
        this.db.run("INSERT INTO relations VALUES (?, ?)", [relation.id, JSON.stringify(relation)]);
      for (const pending of snapshot.pending)
        this.db.run("INSERT INTO pending_items VALUES (?, ?)", [pending.id, JSON.stringify(pending)]);
      for (const protocol of snapshot.protocols)
        this.db.run("INSERT INTO scale_protocols VALUES (?, ?)", [protocol.id, JSON.stringify(protocol)]);
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
    const before = JSON.parse(transaction.payload).before as VaultSnapshot;
    this.db.run("UPDATE transactions SET undone_at = ? WHERE id = ?", [Date.now(), transaction.id]);
    this.replace(before);
    this.flush();
    return before;
  }

  exportBytes() {
    return this.db.export();
  }

  private replace(snapshot: VaultSnapshot) {
    this.db.run("DELETE FROM nodes; DELETE FROM relations; DELETE FROM pending_items; DELETE FROM scale_protocols;");
    for (const node of snapshot.nodes) this.db.run("INSERT INTO nodes VALUES (?, ?)", [node.id, JSON.stringify(node)]);
    for (const relation of snapshot.relations)
      this.db.run("INSERT INTO relations VALUES (?, ?)", [relation.id, JSON.stringify(relation)]);
    for (const pending of snapshot.pending)
      this.db.run("INSERT INTO pending_items VALUES (?, ?)", [pending.id, JSON.stringify(pending)]);
    for (const protocol of snapshot.protocols)
      this.db.run("INSERT INTO scale_protocols VALUES (?, ?)", [protocol.id, JSON.stringify(protocol)]);
  }

  private flush() {
    const binary = this.db.export();
    if (typeof localStorage !== "undefined") {
      let encoded = "";
      for (const byte of binary) encoded += String.fromCharCode(byte);
      localStorage.setItem(DB_KEY, btoa(encoded));
    }
    void this.externalPersist?.(binary);
  }
}
