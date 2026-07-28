# Knowledge Bridge

Knowledge Bridge is a local-first visual knowledge system for connecting familiar concepts, research terms, claims, evidence, and cross-scale explanations. Its interface and canvas are built directly on [graphif/project-graph](https://github.com/graphif/project-graph), rather than reproducing that product's visual language in a separate UI.

## Current V1 foundation

- Project Graph's native Canvas2D renderer, tabs, floating windows, themes, menus, and toolbars
- L1-L4 knowledge roles with separate logical and cognitive relation layers
- evidence levels, perspective-dependent evidence tension, and scale conversion protocols
- an isolated Pending Pool for Markdown links, lineage candidates, and AI bridge suggestions
- stable managed Markdown links using `<!-- kb-link:edge_id -->`, including sever and retarget reconciliation
- a native Knowledge Bridge dock with indexing state, bridge review, evidence, and migration controls
- an initial biology graph rendered as real Project Graph nodes and edges

## Development

Requirements: Node.js 26+ and pnpm 11.

```bash
pnpm install
pnpm --filter @graphif/data-structures --filter @graphif/serializer --filter @graphif/shapes run build
pnpm --filter @knowledge-bridge/app dev --host 127.0.0.1
```

The web preview runs at `http://127.0.0.1:1420/`. The Tauri desktop application uses the same frontend.

## License and upstream attribution

This repository is a derivative work of Project Graph and is distributed under `GPL-3.0-only`. The upstream application and its contributors retain their original copyright. The full license is available at [`app/LICENSE`](app/LICENSE).

Upstream source: https://github.com/graphif/project-graph

Knowledge Bridge-specific changes are maintained at https://github.com/issunmihaichi/Knowledge-Bridge
