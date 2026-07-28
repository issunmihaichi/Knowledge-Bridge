# Knowledge Bridge

Knowledge Bridge is a local-first knowledge graph workspace that opens an Obsidian-compatible Vault, keeps advanced graph semantics in `.knowledge-bridge/graph.db`, and drafts learning bridges without silently promoting AI output to formal knowledge.

## Run

```powershell
pnpm install
pnpm dev
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). Chromium-based browsers are required when opening a real Vault because the browser build uses the File System Access API. The included demo Vault works in any current browser.

```powershell
pnpm typecheck
pnpm test
pnpm build
```

## Storage contract

- Markdown remains the source of truth for note content, tags, attachments, and ordinary `[[wikilinks]]`.
- `.knowledge-bridge/graph.db` stores logical/cognitive edges, write snapshots, evidence evaluations, knowledge lenses, scale protocols, lineage candidates, frozen migrations, and the undo log.
- KB-managed links use `[[Target]] <!-- kb-link:edge_id -->`. Deleting a managed link severs it; the scanner never recreates a severed edge without an explicit restore action.
- Unmarked Obsidian wikilinks enter the Pending Pool as cognitive mentions and never become logical facts automatically.

## AI provider

Without configuration, the app produces clearly labeled local bridge candidates. For a local OpenAI-compatible service, set:

```powershell
$env:VITE_AI_ENDPOINT='http://127.0.0.1:1234/v1'
$env:VITE_AI_MODEL='local-model-name'
pnpm dev
```

The browser build intentionally does not accept a cloud API key. A distributed desktop build should keep cloud credentials behind a native Tauri command and OS credential storage.

## Desktop boundary

The React application and Vault adapter boundary are ready for Tauri, but this machine does not have Rust/Cargo installed, so the native shell is not compiled in this workspace. The current build is a complete browser-hosted local prototype; `BrowserVaultAdapter` is the only module that needs replacement by native file and watcher commands.

Project Graph's GPL application code and assets are not included. The interface was implemented independently using `@xyflow/react`.
