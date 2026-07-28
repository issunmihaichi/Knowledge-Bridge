import { aiRequestHeaders, loadAiConnection, type AiConnectionSettings } from "./aiSettings";
import type { KnowledgeNode } from "./model";

export interface BridgeSuggestion {
  bridgeId: string;
  reason: string;
  confidence: number;
  alternatives: Array<{ id: string; reason: string }>;
  anchorId?: string;
  anchorReason: string;
  anchorEvidence: string[];
  anchorAlternatives: Array<{ id: string; reason: string; confidence: number }>;
  provider: "remote-ai" | "local-fallback";
}

function localSuggestion(selected: KnowledgeNode, nodes: KnowledgeNode[]): BridgeSuggestion | undefined {
  const candidates = nodes.filter((node) => node.role === "L2" && node.status === "formal");
  if (!candidates.length) return undefined;
  const anchors = nodes
    .filter((node) => node.role === "L1" && node.sourceKind !== "denied")
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
): Promise<BridgeSuggestion | undefined> {
  if (!connection.endpoint) return localSuggestion(selected, nodes);
  try {
    const candidates = nodes
      .filter((node) => node.role === "L2" && node.status === "formal")
      .map(({ id, title, content, definition, boundary }) => ({
        id,
        title,
        content: content.slice(0, 500),
        definition,
        boundary,
      }));
    const anchors = nodes
      .filter((node) => node.role === "L1" && node.sourceKind !== "denied")
      .map(({ id, title, anchorLedger }) => ({ id, title, anchorLedger }));
    const response = await fetch(`${connection.endpoint}/chat/completions`, {
      method: "POST",
      headers: aiRequestHeaders(connection),
      body: JSON.stringify({
        model: connection.model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Select a reusable bridge mechanism and a traceable L1 anchor. Return JSON with bridgeId, reason, confidence, alternatives, anchorId, anchorReason, anchorEvidence, anchorAlternatives. Never invent IDs. This is a draft only, never claim a formal fact.",
          },
          { role: "user", content: JSON.stringify({ selected, candidates, anchors }) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`AI request failed: ${response.status}`);
    const parsed = JSON.parse((await response.json()).choices[0].message.content);
    if (!candidates.some((candidate) => candidate.id === parsed.bridgeId))
      throw new Error("AI returned an unknown bridge");
    if (parsed.anchorId && !anchors.some((anchor) => anchor.id === parsed.anchorId))
      throw new Error("AI returned an unknown anchor");
    return {
      ...parsed,
      anchorReason: parsed.anchorReason ?? "AI 未提供锚点理由",
      anchorEvidence: parsed.anchorEvidence ?? [],
      anchorAlternatives: parsed.anchorAlternatives ?? [],
      provider: "remote-ai",
    };
  } catch {
    return localSuggestion(selected, nodes);
  }
}
