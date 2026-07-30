import { aiRequestHeaders, loadAiConnection, type AiConnectionSettings } from "./aiSettings";
import { fetchAi } from "./aiHttp";
import type { BridgeModuleDraft, BridgeModuleStepDraft, KnowledgeNode } from "./model";

export interface BridgeSuggestion {
  bridgeModule: BridgeModuleDraft;
  /** Deprecated compatibility fields for older panel integrations. */
  bridgeId?: string;
  bridgeTitle?: string;
  bridgeDefinition?: string;
  bridgeScope?: string;
  bridgeBoundary?: string;
  isNewBridge?: boolean;
  reason: string;
  confidence: number;
  anchorId?: string;
  anchorReason: string;
  anchorEvidence: string[];
  anchorAlternatives: Array<{ id: string; reason: string; confidence: number }>;
  provider: "remote-ai" | "local-fallback";
  diagnostic?: string;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function localBridgeModule(selected: KnowledgeNode, legacyBridge?: KnowledgeNode): BridgeModuleDraft {
  return {
    title: legacyBridge?.title ?? `理解 ${selected.title} 的桥梁`,
    definition:
      legacyBridge?.definition ?? "把已确认旧知中的对象、关系和条件拆成可检查的中间步骤，再映射到当前的新知识。",
    scope: legacyBridge?.scope ?? "当前选择的新知识与一个个人锚点之间的待复核理解路径。",
    boundary: legacyBridge?.boundary ?? "这不是科学结论；缺少来源、证据或尺度协议时不能升级为强逻辑关系。",
    steps: [
      {
        id: "mapping",
        title: "定位可对应的对象",
        kind: "mapping",
        explanation: "将新概念中的对象、状态或变量与旧知锚点中的对应部分逐一比对。",
      },
      {
        id: "mechanism",
        title: legacyBridge?.title ?? "解释中间变化机制",
        kind: "mechanism",
        explanation: legacyBridge?.content ?? "描述对象如何相互作用、被调节或发生状态转换，不能只写一个宽泛理论名称。",
      },
      {
        id: "boundary",
        title: "标注适用条件与边界",
        kind: "constraint",
        explanation: "明确哪些条件、尺度或证据限制会使这条解释不成立，保留需要复核的部分。",
      },
    ],
  };
}

function normalizeBridgeModule(value: unknown, fallback: BridgeModuleDraft): BridgeModuleDraft | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as { title?: unknown; definition?: unknown; scope?: unknown; boundary?: unknown; steps?: unknown };
  if (!Array.isArray(raw.steps) || raw.steps.length < 2 || raw.steps.length > 5) return undefined;
  const kinds = new Set<BridgeModuleStepDraft["kind"]>(["mapping", "mechanism", "constraint", "scale-transition"]);
  const ids = new Set<string>();
  const steps = raw.steps.flatMap((value, index) => {
    if (!value || typeof value !== "object") return [];
    const step = value as Partial<BridgeModuleStepDraft>;
    const id = text(step.id) ?? `step-${index + 1}`;
    const title = text(step.title);
    const explanation = text(step.explanation);
    if (!step.kind || !kinds.has(step.kind) || !title || !explanation || ids.has(id)) return [];
    ids.add(id);
    return [
      {
        id,
        title,
        kind: step.kind,
        explanation,
        definition: text(step.definition),
        boundary: text(step.boundary),
        evidence: Array.isArray(step.evidence)
          ? step.evidence.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 6)
          : undefined,
      } satisfies BridgeModuleStepDraft,
    ];
  });
  if (steps.length !== raw.steps.length || !steps.some((step) => step.kind === "mechanism")) return undefined;
  return {
    title: text(raw.title) ?? fallback.title,
    definition: text(raw.definition),
    scope: text(raw.scope),
    boundary: text(raw.boundary),
    steps,
  };
}

function localSuggestion(selected: KnowledgeNode, nodes: KnowledgeNode[]): BridgeSuggestion {
  const legacyBridges = nodes.filter((node) => node.role === "L2" && node.status === "formal");
  const anchors = nodes
    .filter(
      (node) =>
        node.role === "L1" &&
        node.status !== "missing-source" &&
        node.status !== "frozen" &&
        node.sourceKind !== "denied",
    )
    .map((node) => {
      const entry = node.anchorLedger?.at(-1);
      const sourceScore = entry?.source === "user-confirmed" ? 0.22 : entry?.source === "behavior" ? 0.14 : 0.06;
      return {
        node,
        score: 0.54 + sourceScore,
        reason: entry?.rationale ?? "来自当前锚点账本中的可审计记录。",
        evidence: entry?.evidence ?? [],
      };
    })
    .sort((left, right) => right.score - left.score);
  const legacyBridge = legacyBridges
    .map((node) => ({
      node,
      score: [...new Set(node.content.match(/[\p{Script=Han}]{2,4}/gu) ?? [])].filter((term) =>
        selected.content.includes(term),
      ).length,
    }))
    .sort((left, right) => right.score - left.score)[0]?.node;
  return {
    bridgeModule: localBridgeModule(selected, legacyBridge),
    reason: "本地草拟将桥接拆为可检查步骤。旧 L2 仅作为历史提示，不会被当作新路径中的单一中间节点。",
    confidence: legacyBridge ? 0.64 : 0.42,
    anchorId: anchors[0]?.node.id,
    anchorReason: anchors[0]?.reason ?? "当前没有可用 L1；请先确认一个可审计的旧知锚点。",
    anchorEvidence: anchors[0]?.evidence ?? [],
    anchorAlternatives: anchors
      .slice(1, 3)
      .map((anchor) => ({ id: anchor.node.id, reason: anchor.reason, confidence: anchor.score })),
    provider: "local-fallback",
  };
}

export async function suggestBridge(
  selected: KnowledgeNode,
  nodes: KnowledgeNode[],
  connection: AiConnectionSettings = loadAiConnection(),
): Promise<BridgeSuggestion> {
  const local = localSuggestion(selected, nodes);
  if (!connection.endpoint) {
    if (!nodes.some((node) => node.role === "L2" && node.status === "formal")) {
      throw new Error("当前没有可复用的正式 L2。请先配置远程 AI，让它草拟一个可拆分的桥梁模块。");
    }
    return local;
  }
  try {
    const anchors = nodes
      .filter(
        (node) =>
          node.role === "L1" &&
          node.status !== "missing-source" &&
          node.status !== "frozen" &&
          node.sourceKind !== "denied",
      )
      .map(({ id, title, anchorLedger }) => ({ id, title, anchorLedger }));
    const existingModules = nodes
      .filter((node) => node.role === "L2" && node.status === "formal")
      .map(({ title, definition, scope, boundary, content }) => ({
        title,
        definition,
        scope,
        boundary,
        content: content.slice(0, 400),
      }));
    const response = await fetchAi(`${connection.endpoint}/chat/completions`, {
      method: "POST",
      headers: aiRequestHeaders(connection),
      body: JSON.stringify({
        model: connection.model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Draft an auditable personal learning bridge. Return JSON with bridgeModule, reason, confidence, anchorId, anchorReason, anchorEvidence, and anchorAlternatives. bridgeModule must contain title, definition, scope, boundary, and 2-5 ordered steps. Every step has id, title, kind (mapping, mechanism, constraint, scale-transition), and explanation; at least one is mechanism. The bridge must be decomposed: never use or return a single L2 node ID. A draft is not formal knowledge or evidence. Never invent anchor IDs.",
          },
          { role: "user", content: JSON.stringify({ selected, anchors, existingModules }) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`AI request failed: ${response.status}`);
    const responseBody = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = responseBody.choices?.[0]?.message?.content;
    if (!content) throw new Error("AI returned an empty response");
    const parsed = JSON.parse(
      content
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, ""),
    ) as {
      bridgeModule?: unknown;
      reason?: unknown;
      confidence?: unknown;
      anchorId?: unknown;
      anchorReason?: unknown;
      anchorEvidence?: unknown;
      anchorAlternatives?: unknown;
    };
    const legacyTitle = text((parsed as { bridgeTitle?: unknown }).bridgeTitle);
    const legacyModule = legacyTitle
      ? {
          ...local.bridgeModule,
          title: legacyTitle,
          definition:
            text((parsed as { bridgeDefinition?: unknown }).bridgeDefinition) ?? local.bridgeModule.definition,
          scope: text((parsed as { bridgeScope?: unknown }).bridgeScope) ?? local.bridgeModule.scope,
          boundary: text((parsed as { bridgeBoundary?: unknown }).bridgeBoundary) ?? local.bridgeModule.boundary,
        }
      : local.bridgeModule;
    const bridgeModule =
      normalizeBridgeModule(parsed.bridgeModule, legacyModule) ?? (legacyTitle ? legacyModule : undefined);
    if (!bridgeModule) throw new Error("AI did not return a decomposed bridge module with a mechanism step");
    const anchorIds = new Set(anchors.map((anchor) => anchor.id));
    if (typeof parsed.anchorId === "string" && !anchorIds.has(parsed.anchorId))
      throw new Error("AI returned an unknown anchor");
    return {
      bridgeModule,
      bridgeId: `proposed-l2:${crypto.randomUUID()}`,
      bridgeTitle: bridgeModule.title,
      bridgeDefinition: bridgeModule.definition,
      bridgeScope: bridgeModule.scope,
      bridgeBoundary: bridgeModule.boundary,
      isNewBridge: true,
      reason: text(parsed.reason) ?? "AI did not provide a bridge rationale.",
      confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
      anchorId: typeof parsed.anchorId === "string" ? parsed.anchorId : undefined,
      anchorReason: text(parsed.anchorReason) ?? "AI did not explain the anchor choice.",
      anchorEvidence: Array.isArray(parsed.anchorEvidence)
        ? parsed.anchorEvidence.filter((item): item is string => typeof item === "string").slice(0, 5)
        : [],
      anchorAlternatives: Array.isArray(parsed.anchorAlternatives)
        ? parsed.anchorAlternatives
            .filter((item): item is { id?: unknown; reason?: unknown; confidence?: unknown } =>
              Boolean(item && typeof item === "object"),
            )
            .map((item) => ({
              id: typeof item.id === "string" ? item.id : "",
              reason: typeof item.reason === "string" ? item.reason : "AI did not provide a reason.",
              confidence: typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : 0.5,
            }))
            .filter((item) => anchorIds.has(item.id) && item.id !== parsed.anchorId)
            .slice(0, 3)
        : [],
      provider: "remote-ai",
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ...local,
      diagnostic: `远程 AI 未完成请求（${reason}），当前显示本地桥梁模块草拟。`,
    };
  }
}
