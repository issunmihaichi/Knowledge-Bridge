import type { KnowledgeNode } from "./model";

export interface BridgeSuggestion {
  bridgeId: string;
  reason: string;
  confidence: number;
  alternatives: Array<{ id: string; reason: string }>;
  provider: "remote-ai" | "local-fallback";
}

function localSuggestion(selected: KnowledgeNode, nodes: KnowledgeNode[]): BridgeSuggestion | undefined {
  const candidates = nodes.filter((node) => node.role === "L2" && node.status === "formal");
  if (!candidates.length) return undefined;
  const ranked = candidates.map((node) => {
    const shared = [...new Set(node.content.match(/[\p{Script=Han}]{2,4}/gu) ?? [])].filter((term) => selected.content.includes(term)).length;
    return { node, score: 0.68 + Math.min(shared * 0.06, 0.18) };
  }).sort((left, right) => right.score - left.score);
  return {
    bridgeId: ranked[0].node.id,
    reason: "本地候选：基于已复核 L2、正文词汇重合和当前学习角色；尚未调用远程模型。",
    confidence: ranked[0].score,
    alternatives: ranked.slice(1, 3).map(({ node }) => ({ id: node.id, reason: "同为当前知识库中的正式可复用机制" })),
    provider: "local-fallback",
  };
}

export async function suggestBridge(selected: KnowledgeNode, nodes: KnowledgeNode[]): Promise<BridgeSuggestion | undefined> {
  const endpoint = import.meta.env.LR_AI_ENDPOINT as string | undefined;
  if (!endpoint) return localSuggestion(selected, nodes);
  try {
    const candidates = nodes.filter((node) => node.role === "L2" && node.status === "formal").map(({ id, title, content }) => ({ id, title, content: content.slice(0, 500) }));
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: import.meta.env.LR_AI_MODEL ?? "gpt-4.1-mini", response_format: { type: "json_object" }, messages: [{ role: "system", content: "Select a reusable bridge mechanism. Return JSON with bridgeId, reason, confidence, alternatives. Never invent IDs." }, { role: "user", content: JSON.stringify({ selected, candidates }) }] }),
    });
    if (!response.ok) throw new Error(`AI request failed: ${response.status}`);
    const parsed = JSON.parse((await response.json()).choices[0].message.content);
    if (!candidates.some((candidate) => candidate.id === parsed.bridgeId)) throw new Error("AI returned an unknown bridge");
    return { ...parsed, provider: "remote-ai" };
  } catch {
    return localSuggestion(selected, nodes);
  }
}
