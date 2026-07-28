# Project Graph upstream bridge

Knowledge Bridge is maintained as a small product layer on top of the Project Graph codebase. The goal is to keep future upstream updates reviewable rather than to freeze a copied interface.

## Remote and update flow

The repository has a read-only `project-graph` remote pointing to `https://github.com/graphif/project-graph.git`.

1. Fetch `project-graph`.
2. Review its changes since the last imported base before merging or rebasing.
3. Resolve only the integration files below, then run the Knowledge Bridge test suite, type check, and production build.
4. Record the imported upstream commit in the merge or rebase message.

## Ownership boundary

- `app/src/knowledge-bridge/` contains all domain rules, AI orchestration, ledger state, Vault sync, and bridge UI data. It is product-owned.
- `app/src/sub/KnowledgeBridgeWelcomeWindow.tsx` and `app/src/sub/KnowledgeBridgeWindow.tsx` are the only Project Graph window mounts for the welcome flow and workspace.
- `app/src/components/global-menu-content.tsx` is a presentation-only menu filter. It keeps the original commands available through the command palette while reducing the default menu to daily actions.
- `app/src/core/service/controlService/controller/concrete/ControllerNodeEdit.tsx`, `app/src/core/service/controlService/controller/concrete/utilsControl.tsx`, `app/src/core/stage/stageObject/entity/TextNode.tsx`, and `app/src/sub/NodeDetailsWindow.tsx` are the only deliberate core hooks. Together they provide one-click node details and a single reusable detail editor.

Do not place knowledge semantics in the renderer, stage, selection controller, or Project Graph serialization model. New Knowledge Bridge features should first be added under `app/src/knowledge-bridge/`, then exposed through `KnowledgeBridgeWindow` or one documented hook above.
