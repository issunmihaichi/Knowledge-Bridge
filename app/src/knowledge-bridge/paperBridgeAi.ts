import { aiRequestHeaders, loadAiConnection, type AiConnectionSettings } from "./aiSettings";
import type { KnowledgeNode, PaperBridgeDraft, PaperBridgeStep, VaultSnapshot } from "./model";

function titleFromInput(input: string): string {
  const line = input
    .split(/\r?\n/)
    .map((value) => value.replace(/^#+\s*/, "").trim())
    .find(Boolean);
  return (line ?? "未命名材料").slice(0, 90);
}

function findAnchor(snapshot: VaultSnapshot): KnowledgeNode | undefined {
  return (
    snapshot.nodes.find((node) => node.role === "L1" && node.sourceKind === "user-confirmed") ??
    snapshot.nodes.find((node) => node.role === "L1" && node.sourceKind !== "denied")
  );
}

function findBridge(snapshot: VaultSnapshot, input: string): KnowledgeNode | undefined {
  const normalized = input.toLocaleLowerCase();
  const ranked = snapshot.nodes
    .filter((node) => node.role === "L2" && node.status === "formal")
    .map((node) => {
      const terms =
        `${node.title} ${node.content} ${node.scope ?? ""}`.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
      return { node, score: terms.filter((term) => normalized.includes(term)).length };
    })
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.node;
}

function findFrontierConcept(snapshot: VaultSnapshot, input: string): KnowledgeNode | undefined {
  return snapshot.nodes.find(
    (node) => node.role === "L3" && input.toLocaleLowerCase().includes(node.title.toLocaleLowerCase()),
  );
}

export function draftPaperBridgeLocally(
  input: string,
  snapshot: VaultSnapshot,
  now = Date.now(),
  diagnostic = "尚未连接 AI，以下为基于当前知识账本的本地草拟。",
): PaperBridgeDraft {
  const anchor = findAnchor(snapshot);
  const bridge = findBridge(snapshot, input);
  const frontier = findFrontierConcept(snapshot, input);
  const frontierTitle = frontier?.title ?? titleFromInput(input);
  const chain: PaperBridgeStep[] = [
    {
      id: "frontier",
      nodeId: frontier?.id,
      title: frontierTitle,
      role: "frontier-concept",
      explanation: frontier
        ? "材料输入命中已有前沿概念；仍需核对原文中的具体主张。"
        : "从材料标题、段落或问题中捕获的待解析概念。",
      state: frontier ? "existing" : "proposed",
    },
    {
      id: "bridge",
      nodeId: bridge?.id,
      title: bridge?.title ?? "待确认桥梁机制",
      role: "bridge-mechanism",
      explanation: bridge
        ? `尝试用“${bridge.title}”解释新概念如何回连旧知；这是草拟关系。`
        : "需要从已复核 L2 中选择能够说明中间机制的桥梁。",
      state: bridge ? "existing" : "proposed",
    },
    {
      id: "anchor",
      nodeId: anchor?.id,
      title: anchor?.title ?? "待确认学习锚点",
      role: "learning-anchor",
      explanation: anchor
        ? "回到已确认的学习锚点，再检查材料是否真正补足了中间机制。"
        : "尚未找到可审计的 L1；不能把这条链当作正式理解。",
      state: anchor ? "existing" : "proposed",
    },
  ];
  return {
    id: `paper-draft:${crypto.randomUUID()}`,
    title: titleFromInput(input),
    input,
    summary: "本地草拟仅根据当前知识账本的已确认锚点与 L2 生成，不代表材料结论或正式知识。",
    chain,
    anchorReason: anchor?.anchorLedger?.at(-1)?.rationale ?? "没有可用的用户确认锚点。",
    confidence: anchor && bridge ? 0.62 : 0.34,
    provider: "local-fallback",
    diagnostic,
    status: "draft",
    createdAt: now,
  };
}

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const json = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(json);
}

function normalizeRemoteDraft(
  value: unknown,
  input: string,
  snapshot: VaultSnapshot,
  now: number,
): PaperBridgeDraft | undefined {
  if (!value || typeof value !== "object") return undefined;
  const parsed = value as Partial<PaperBridgeDraft> & { chain?: unknown };
  if (!Array.isArray(parsed.chain) || parsed.chain.length < 2) return undefined;
  const knownNodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const chain = parsed.chain.slice(0, 5).flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Partial<PaperBridgeStep>;
    const known = item.nodeId ? knownNodes.get(item.nodeId) : undefined;
    const role = item.role;
    if (!role || !["frontier-concept", "bridge-mechanism", "learning-anchor", "high-school-anchor", "scale-gap"].includes(role)) return [];
    return [
      {
        id: item.id?.trim() || `remote-${index}`,
        nodeId: known?.id,
        title: known?.title ?? item.title?.trim() ?? "待确认概念",
        role: role === "high-school-anchor" ? "learning-anchor" : role,
        explanation: item.explanation?.trim() ?? "AI 未提供充分解释。",
        state: known ? "existing" : "proposed",
      } satisfies PaperBridgeStep,
    ];
  });
  const requiredRoles = ["frontier-concept", "bridge-mechanism", "learning-anchor"] as const;
  if (!requiredRoles.every((role) => chain.some((step) => step.role === role))) return undefined;
  const mustUseAuditedAnchor = snapshot.nodes.some((node) => node.role === "L1" && node.sourceKind !== "denied");
  if (mustUseAuditedAnchor && !chain.some((step) => step.role === "learning-anchor" && step.nodeId)) return undefined;
  const order: PaperBridgeStep["role"][] = ["frontier-concept", "scale-gap", "bridge-mechanism", "learning-anchor"];
  const orderedChain = order.flatMap((role) => chain.filter((step) => step.role === role));
  return {
    id: `paper-draft:${crypto.randomUUID()}`,
    title: parsed.title?.trim() || titleFromInput(input),
    input,
    summary: parsed.summary?.trim() || "AI 未提供摘要。",
    chain: orderedChain,
    anchorReason: parsed.anchorReason?.trim() || "AI 未提供锚点选择理由。",
    confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    provider: "remote-ai",
    status: "draft",
    createdAt: now,
  };
}

export async function draftPaperBridge(
  input: string,
  snapshot: VaultSnapshot,
  now = Date.now(),
  connection: AiConnectionSettings = loadAiConnection(),
): Promise<PaperBridgeDraft> {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("请先输入论文、教材、笔记或问题片段");
  if (!connection.endpoint) return draftPaperBridgeLocally(trimmed, snapshot, now);

  const candidates = snapshot.nodes
    .filter((node) => node.role === "L1" || node.role === "L2" || node.role === "L3")
    .map(({ id, title, role, content, sourceKind, definition, boundary }) => ({
      id,
      title,
      role,
      content: content.slice(0, 400),
      sourceKind,
      definition,
      boundary,
    }));
  try {
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
              "You draft study scaffolds only. Given source material from any discipline and a local knowledge ledger, return JSON with title, summary, anchorReason, confidence, and chain. chain must be ordered frontier-concept -> bridge-mechanism -> learning-anchor, with scale-gap only when the input skips a needed mechanism. Each step contains nodeId only when it is one of the supplied IDs. If supplied L1 anchors exist, the learning-anchor must use one of their IDs. Do not assert that the material proves a claim.",
          },
          { role: "user", content: JSON.stringify({ sourceMaterial: trimmed, candidates }) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`AI request failed: ${response.status}`);
    const responseBody = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = responseBody.choices?.[0]?.message?.content;
    const draft = content ? normalizeRemoteDraft(parseJsonContent(content), trimmed, snapshot, now) : undefined;
    return draft ?? draftPaperBridgeLocally(trimmed, snapshot, now, "AI 返回的链条未通过锚点或结构校验，以下为本地草拟。");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知错误";
    return draftPaperBridgeLocally(trimmed, snapshot, now, `AI 请求未完成（${reason}），以下为本地草拟。`);
  }
}
