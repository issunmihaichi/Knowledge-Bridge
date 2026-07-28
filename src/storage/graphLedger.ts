import initSqlJs, { type Database } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import type { KnowledgeNode, KnowledgeRelation, ManagedLinkSnapshot } from '../domain/types'

const DB_KEY = 'knowledge-bridge.graph.db'

export interface LedgerExport {
  nodes: KnowledgeNode[]
  relations: KnowledgeRelation[]
}

function rows<T>(db: Database, query: string): T[] {
  const result = db.exec(query)[0]
  if (!result) return []
  return result.values.map((values) =>
    Object.fromEntries(result.columns.map((column, index) => [column, values[index]])),
  ) as T[]
}

export class GraphLedger {
  private constructor(
    private readonly db: Database,
    private readonly externalPersist?: (bytes: Uint8Array) => Promise<void>,
  ) {}

  static async open(bytes?: Uint8Array, externalPersist?: (bytes: Uint8Array) => Promise<void>): Promise<GraphLedger> {
    const SQL = await initSqlJs({
      locateFile: () => wasmUrl,
    })
    const stored = !bytes ? localStorage.getItem(DB_KEY) : null
    const initial = bytes ?? (stored ? Uint8Array.from(atob(stored), (char) => char.charCodeAt(0)) : undefined)
    const ledger = new GraphLedger(new SQL.Database(initial), externalPersist)
    ledger.migrate()
    return ledger
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS relations (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS link_snapshots (edge_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS anchor_ledger (node_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS evidence_evaluations (id TEXT PRIMARY KEY, claim_id TEXT NOT NULL, evidence_id TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS knowledge_lenses (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS scale_protocols (id TEXT PRIMARY KEY, source_scale TEXT NOT NULL, target_scale TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pending_items (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lineage_candidates (id TEXT PRIMARY KEY, file_path TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS migration_paths (id TEXT PRIMARY KEY, frozen_l2_id TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        undone_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `)
  }

  load(): LedgerExport {
    const nodes = rows<{ payload: string }>(this.db, 'SELECT payload FROM nodes').map((row) => JSON.parse(row.payload))
    const relations = rows<{ payload: string }>(this.db, 'SELECT payload FROM relations').map((row) => JSON.parse(row.payload))
    return { nodes, relations }
  }

  save(nodes: KnowledgeNode[], relations: KnowledgeRelation[], kind = 'graph-save'): void {
    const before = this.load()
    this.db.run('BEGIN')
    try {
      this.db.run('DELETE FROM nodes; DELETE FROM relations;')
      for (const node of nodes) this.db.run('INSERT INTO nodes VALUES (?, ?)', [node.id, JSON.stringify(node)])
      for (const relation of relations) this.db.run('INSERT INTO relations VALUES (?, ?)', [relation.id, JSON.stringify(relation)])
      this.db.run('INSERT INTO transactions(kind, payload, created_at) VALUES (?, ?, ?)', [
        kind,
        JSON.stringify({ before, after: { nodes, relations } }),
        Date.now(),
      ])
      this.db.run('COMMIT')
      this.flush()
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }

  saveSnapshot(snapshot: ManagedLinkSnapshot): void {
    this.db.run('INSERT OR REPLACE INTO link_snapshots VALUES (?, ?)', [snapshot.edgeId, JSON.stringify(snapshot)])
    this.flush()
  }

  getSnapshot(edgeId: string): ManagedLinkSnapshot | undefined {
    const statement = this.db.prepare('SELECT payload FROM link_snapshots WHERE edge_id = ?')
    statement.bind([edgeId])
    const value = statement.step() ? JSON.parse(String(statement.getAsObject().payload)) : undefined
    statement.free()
    return value
  }

  setMetadata(key: string, value: unknown): void {
    this.db.run('INSERT OR REPLACE INTO metadata VALUES (?, ?)', [key, JSON.stringify(value)])
    this.flush()
  }

  getMetadata<T>(key: string): T | undefined {
    const statement = this.db.prepare('SELECT value FROM metadata WHERE key = ?')
    statement.bind([key])
    const value = statement.step() ? JSON.parse(String(statement.getAsObject().value)) as T : undefined
    statement.free()
    return value
  }

  undo(): LedgerExport | undefined {
    const result = rows<{ id: number; payload: string }>(this.db, 'SELECT id, payload FROM transactions WHERE undone_at IS NULL ORDER BY id DESC LIMIT 1')[0]
    if (!result) return undefined
    const transaction = JSON.parse(result.payload) as { before: LedgerExport }
    this.db.run('UPDATE transactions SET undone_at = ? WHERE id = ?', [Date.now(), result.id])
    this.replaceWithoutTransaction(transaction.before)
    this.flush()
    return transaction.before
  }

  exportBytes(): Uint8Array {
    return this.db.export()
  }

  private replaceWithoutTransaction(snapshot: LedgerExport): void {
    this.db.run('DELETE FROM nodes; DELETE FROM relations;')
    for (const node of snapshot.nodes) this.db.run('INSERT INTO nodes VALUES (?, ?)', [node.id, JSON.stringify(node)])
    for (const relation of snapshot.relations) this.db.run('INSERT INTO relations VALUES (?, ?)', [relation.id, JSON.stringify(relation)])
  }

  private flush(): void {
    const binary = this.db.export()
    let encoded = ''
    for (const byte of binary) encoded += String.fromCharCode(byte)
    localStorage.setItem(DB_KEY, btoa(encoded))
    void this.externalPersist?.(binary)
  }
}
