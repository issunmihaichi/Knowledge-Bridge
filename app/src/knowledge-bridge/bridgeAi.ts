import { aiRequestHeaders, loadAiConnection, type AiConnectionSettings } from "./aiSettings";
import { fetchAi } from "./aiHttp";
import type { KnowledgeNode } from "./model";

export interface BridgeSuggestion {
  bridgeId: string;
  bridgeTitle: string;
  bridgeDefinition?: string;
  bridgeScope?: string;
  bridgeBoundary?: string;
  isNewBridge: boolean;
  reason: string;
  confidence: number;
  alternatives: Array<{ id: string; reason: string }>;
  anchorId?: string;
  anchorReason: string;
  anchorEvidence: string[];
  anchorAlternatives: Array<{ id: string; reason: string; confidence: number }>;
  provider: "remote-ai" | "local-fallback";
  diagnostic?: string;
}

function localSuggestion(selected: KnowledgeNode, nodes: KnowledgeNode[]): BridgeSuggestion | undefined {
  const candidates = nodes.filter((node) => node.role === "L2" && node.status === "formal");
  if (!candidates.length) return undefined;
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
        score: 0.58 + sourceScore,
        reason: entry?.rationale ?? "来自当前锚点账本的可审计记录",
        evidence: entry?.evidence ?? [],
      };
    })
    .sort((left, right) => right.score - left.score);
  const ranked = candidates
    .map((node) => {
      const shared = [...new Set(node.content.match(/[\p{Script=Han}]{2,4}/gu) ?? [])].filter((term) =>
        selected.content.includes(term),
      ).length;
      return { node, score: 0.68 + Math.min(shared * 0.06, 0.18) };
    })
    .sort((left, right) => right.score - left.score);
  return {
    bridgeId: ranked[0].node.id,
    bridgeTitle: ranked[0].node.title,
    bridgeDefinition: ranked[0].node.definition,
    bridgeScope: ranked[0].node.scope,
    bridgeBoundary: ranked[0].node.boundary,
    isNewBridge: false,
    reason: "本地候选：基于已复核 L2、正文词汇重合和当前学习角色；尚未调用远程模型。",
    confidence: ranked[0].score,
    alternatives: ranked.slice(1, 3).map(({ node }) => ({ id: node.id, reason: "同为当前知识库中的正式可复用机制" })),
    anchorId: anchors[0]?.node.id,
    anchorReason: anchors[0]?.reason ?? "当前没有可用 L1，建议先建立可审计锚点。",
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
  if (!connection.endpoint) {
    const local = localSuggestion(selected, nodes);
    if (local) return local;
    throw new Error("当前没有可复用的正式 L2。请先配置远程 AI，让它草拟一个新的桥梁机制候选。");
  }
  try {
    const candidates = nodes
      .filter((node) => node.role === "L2" && node.status === "formal")
      .map(({ id, title, content, definition, scope, boundary }) => ({
        id,
        title,
        content: content.slice(0, 500),
        definition,
        scope,
        boundary,
      }));
    const anchors = nodes
      .filter(
        (node) =>
          node.role === "L1" &&
          node.status !== "missing-source" &&
          node.status !== "frozen" &&
          node.sourceKind !== "denied",
      )
      .map(({ id, title, anchorLedger }) => ({ id, title, anchorLedger }));
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
              "Select a reusable bridge mechanism and a traceable L1 anchor. Prefer an existing candidate and return its exact bridgeId. If no existing mechanism is suitable, set bridgeId to null and propose a specific bridgeTitle, bridgeDefinition, bridgeScope, and bridgeBoundary. Return JSON with bridgeId, bridgeTitle, bridgeDefinition, bridgeScope, bridgeBoundary, reason, confidence, alternatives, anchorId, anchorReason, anchorEvidence, anchorAlternatives. Never invent IDs. A proposed mechanism is only a candidate, never formal knowledge.",
          },
          { role: "user", content: JSON.stringify({ selected, candidates, anchors }) },
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
    );
    const existingBridge = candidates.find((candidate) => candidate.id === parsed.bridgeId);
    const proposedTitle = typeof parsed.bridgeTitle === "string" ? parsed.bridgeTitle.trim() : "";
    if (!existingBridge && !proposedTitle) throw new Error("AI did not return a valid bridge mechanism");
    if (parsed.anchorId && !anchors.some((anchor) => anchor.id === parsed.anchorId))
      throw new Error("AI returned an unknown anchor");
    const alternativeIds = new Set(candidates.map((candidate) => candidate.id));
    const anchorIds = new Set(anchors.map((anchor) => anchor.id));
    return {
      bridgeId: existingBridge?.id ?? `proposed-l2:${crypto.randomUUID()}`,
      bridgeTitle: existingBridge?.title ?? proposedTitle,
      bridgeDefinition:
        existingBridge?.definition ??
        (typeof parsed.bridgeDefinition === "string" ? parsed.bridgeDefinition.trim() : undefined),
      bridgeScope:
        existingBridge?.scope ?? (typeof parsed.bridgeScope === "string" ? parsed.bridgeScope.trim() : undefined),
      bridgeBoundary:
        existingBridge?.boundary ??
        (typeof parsed.bridgeBoundary === "string" ? parsed.bridgeBoundary.trim() : undefined),
      isNewBridge: !existingBridge,
      reason: typeof parsed.reason === "string" ? parsed.reason : "AI 未提供桥梁理由。",
      confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
      alternatives: Array.isArray(parsed.alternatives)
        ? parsed.alternatives
            .filter((item: unknown) => item && typeof item === "object")
            .map((item: { id?: unknown; reason?: unknown }) => ({
              id: typeof item.id === "string" ? item.id : "",
              reason: typeof item.reason === "string" ? item.reason : "AI 未提供理由。",
            }))
            .filter((item: { id: string }) => alternativeIds.has(item.id) && item.id !== parsed.bridgeId)
            .slice(0, 3)
        : [],
      anchorId: typeof parsed.anchorId === "string" && anchorIds.has(parsed.anchorId) ? parsed.anchorId : undefined,
      anchorReason: typeof parsed.anchorReason === "string" ? parsed.anchorReason : "AI 未提供锚点理由",
      anchorEvidence: Array.isArray(parsed.anchorEvidence)
        ? parsed.anchorEvidence.filter((item: unknown): item is string => typeof item === "string").slice(0, 5)
        : [],
      anchorAlternatives: Array.isArray(parsed.anchorAlternatives)
        ? parsed.anchorAlternatives
            .filter((item: unknown) => item && typeof item === "object")
            .map((item: { id?: unknown; reason?: unknown; confidence?: unknown }) => ({
              id: typeof item.id === "string" ? item.id : "",
              reason: typeof item.reason === "string" ? item.reason : "AI 未提供理由。",
              confidence: typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : 0.5,
            }))
            .filter((item: { id: string }) => anchorIds.has(item.id) && item.id !== parsed.anchorId)
            .slice(0, 3)
        : [],
      provider: "remote-ai",
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const local = localSuggestion(selected, nodes);
    if (local) {
      return {
        ...local,
        diagnostic: `远程 AI 未完成请求（${reason}），当前显示的是本地复用候选。`,
      };
    }
    throw new Error(`远程 AI 未完成请求：${reason}`, { cause: error });
  }
}
