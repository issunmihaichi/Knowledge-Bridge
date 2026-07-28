# Knowledge Bridge

Knowledge Bridge is a local-first visual knowledge system for connecting familiar concepts, research terms, claims, evidence, and cross-scale explanations. It is maintained on top of [graphif/project-graph](https://github.com/graphif/project-graph), so the canvas, interaction model, and visual language remain native to Project Graph.

## Current V1 foundation

- Project Graph's native Canvas2D renderer, tabs, floating windows, themes, menus, and toolbars
- L1-L4 knowledge roles with separate logical and cognitive relation layers
- evidence levels, perspective-dependent evidence tension, and scale conversion protocols
- an isolated Pending Pool for Markdown links, lineage candidates, and AI bridge suggestions
- stable managed Markdown links using `<!-- kb-link:edge_id -->`, including sever and retarget reconciliation
- a native Knowledge Bridge dock with indexing state, bridge review, evidence, and migration controls
- an all-subject welcome workspace that starts from a user-confirmed learning anchor and source material
- a configurable OpenAI-compatible AI connection for material-to-learning-anchor drafts

## Development

Requirements: Node.js 26+ and pnpm 11.

```bash
pnpm install
pnpm --filter @graphif/data-structures --filter @graphif/serializer --filter @graphif/shapes run build
pnpm --filter @knowledge-bridge/app dev --host 127.0.0.1
```

The web preview runs at `http://127.0.0.1:1420/`. The Tauri desktop application uses the same frontend.

## Persistent storage

The first-run preview is a browser-local working copy so that the canvas can open immediately. In Knowledge Bridge, choose **Connect Vault** and select an Obsidian-compatible Vault folder. The application then reads or creates:

```text
<Vault>/.knowledge-bridge/graph.db
```

This SQLite ledger holds the formal graph, AI drafts, pending mentions, evidence evaluations, scale protocols, and version history. Markdown remains the source for note body text, tags, and ordinary links. After a Vault is connected, graph changes are saved automatically to `graph.db`; reopening that Vault restores the same graph. The status badge distinguishes browser-local **Temporary** storage from Vault-backed **Saved** storage.

## AI connection

Open `Knowledge Bridge` and use the AI settings control at the bottom of its side panel to enter an OpenAI-compatible base URL, model name, and (when required) API key. The key is retained only in local application storage on that device. A generated chain is always a draft: it shows the selected L1 anchor and L2 mechanism, can be saved, and still requires explicit adoption before it becomes a learning path.

Without an AI connection, Knowledge Bridge produces a clearly labeled local draft from the existing ledger. If a configured service fails, the result is labeled as a fallback and includes the failure reason.

## License and upstream attribution

This repository is a derivative work of Project Graph and is distributed under `GPL-3.0-only`. The upstream application and its contributors retain their original copyright. The full license is available at [`app/LICENSE`](app/LICENSE).

Upstream source: https://github.com/graphif/project-graph

Knowledge Bridge-specific changes are maintained at https://github.com/issunmihaichi/Knowledge-Bridge

See [UPSTREAM.md](UPSTREAM.md) for the documented Project Graph update boundary and sync procedure.
