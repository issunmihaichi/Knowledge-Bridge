import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { Project } from "@/core/Project";
import { loadAiConnection, saveAiConnection, type AiConnectionSettings } from "@/knowledge-bridge/aiSettings";
import { LocalKnowledgeBridgeBackend, type KnowledgeBridgeBackend } from "@/knowledge-bridge/backend";
import { suggestBridge, type BridgeSuggestion } from "@/knowledge-bridge/bridgeAi";
import {
  INDEX_CACHE_METADATA_KEY,
  indexVaultIncrementally,
  markMissingSources,
  syncChangedNodeSources,
  toPending,
  type IndexedFile,
} from "@/knowledge-bridge/indexer";
import { GraphLedger, type LedgerSideEffects } from "@/knowledge-bridge/ledger";
import { rejectPendingMcpRequests } from "@/knowledge-bridge/mcpOrchestrator";
import {
  createAgentProposalOperation,
  createCanvasPositionOperation,
  createNodeDetailsOperation,
  createPendingResolutionOperation,
} from "@/knowledge-bridge/operations";
import { writeLineageBinding, type PendingResolutionAction } from "@/knowledge-bridge/pending";
import {
  markdownBody,
  mergeMarkdownBody,
  prepareManagedLinkWrite,
  reconcileVaultManagedLinks,
} from "@/knowledge-bridge/sync";
import {
  applyHighConfidenceMigration,
  buildFrozenL2MigrationPreview,
  evaluateL2Admission,
  freezeL2,
  relationBundles,
} from "@/knowledge-bridge/governance";
import {
  demoVaultSnapshot,
  emptyVaultSnapshot,
  type IndexProgress,
  type KnowledgeGraphOperationMeta,
  type McpToolRequestStatus,
  type PaperBridgeDraft,
  type PendingMention,
  type VaultFile,
  type VaultSnapshot,
} from "@/knowledge-bridge/model";
import {
  DemoVaultAdapter,
  KNOWLEDGE_BRIDGE_LEDGER_PATH,
  pickVault,
  rememberRecentVault,
  restoreRecentVault,
  type VaultAdapter,
} from "@/knowledge-bridge/vault";
import {
  ArchiveRestore,
  Bot,
  Check,
  CircleAlert,
  Database,
  FileQuestion,
  GitBranch,
  Link2,
  LoaderCircle,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import { useAtomValue } from "jotai";
import { Vector } from "@graphif/data-structures";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { activeResourceTabAtom } from "@/state";

const kindLabels: Record<PendingMention["kind"], string> = {
  wikilink: "双链提及",
  orphan: "孤立来源",
  lineage: "血缘候选",
  "ai-bridge": "AI 桥梁",
  "scale-gap": "尺度鸿沟",
  "severed-link": "已剪断链接",
};

export interface KnowledgeBridgeLaunchOptions {
  initialVaultName?: string;
  initialInput?: string;
  initialAnchor?: string;
  freshStart?: boolean;
}

type LedgerStatus = "loading" | "ready" | "saving" | "error";

function createStarterSnapshot(initialAnchor?: string): VaultSnapshot {
  const snapshot = structuredClone(emptyVaultSnapshot);
  const anchor = initialAnchor?.trim();
  if (!anchor) return snapshot;
  snapshot.nodes.push({
    id: `welcome-anchor:${crypto.randomUUID()}`,
    title: anchor,
    role: "L1",
    status: "formal",
    content: "来自欢迎工作区的用户确认学习锚点。",
    x: -220,
    y: 0,
    sourceKind: "user-confirmed",
    anchorLedger: [
      {
        source: "user-confirmed",
        rationale: "用户在欢迎工作区确认这是可回连的已有知识。",
        evidence: ["欢迎工作区输入"],
        recordedAt: Date.now(),
      },
    ],
  });
  return snapshot;
}

/** Add a newly confirmed anchor without discarding the learner's existing ledger. */
function appendInitialAnchor(snapshot: VaultSnapshot, initialAnchor?: string): VaultSnapshot {
  const anchor = initialAnchor?.trim();
  if (!anchor) return snapshot;
  const normalized = anchor.toLocaleLowerCase();
  if (snapshot.nodes.some((node) => node.role === "L1" && node.title.trim().toLocaleLowerCase() === normalized)) {
    return snapshot;
  }
  const existingAnchors = snapshot.nodes.filter((node) => node.role === "L1").length;
  return {
    ...snapshot,
    nodes: [
      ...snapshot.nodes,
      {
        id: `welcome-anchor:${crypto.randomUUID()}`,
        title: anchor,
        role: "L1",
        status: "formal",
        content: "User-confirmed learning anchor added while resuming an existing knowledge ledger.",
        x: -220,
        y: existingAnchors * 120,
        sourceKind: "user-confirmed",
        anchorLedger: [
          {
            source: "user-confirmed",
            rationale: "User confirmed this as prior knowledge before extending the existing knowledge ledger.",
            evidence: ["Knowledge Bridge welcome input"],
            recordedAt: Date.now(),
          },
        ],
      },
    ],
  };
}

function hasSnapshotContent(snapshot: VaultSnapshot): boolean {
  return Boolean(
    snapshot.nodes.length ||
    snapshot.relations.length ||
    snapshot.pending.length ||
    snapshot.protocols.length ||
    snapshot.lenses.length ||
    snapshot.argumentRoles.length ||
    snapshot.migrationRecords.length ||
    snapshot.paperDrafts.length ||
    snapshot.graphProposals.length,
  );
}

function isBundledBiologyDemo(snapshot: VaultSnapshot): boolean {
  const demoIds = new Set(demoVaultSnapshot.nodes.map((node) => node.id));
  return (
    snapshot.nodes.length === demoVaultSnapshot.nodes.length &&
    snapshot.nodes.every((node) => demoIds.has(node.id)) &&
    snapshot.pending.length === 0 &&
    snapshot.paperDrafts.length === 0
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 flex-1 border-r px-3 last:border-r-0">
      <div className="text-muted-foreground text-[11px]">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

interface HoverPreviewState {
  nodeId: string;
  x: number;
  y: number;
}

function HoverPreviewLayer({ preview, snapshot }: { preview?: HoverPreviewState; snapshot: VaultSnapshot }) {
  if (!preview) return null;
  const node = snapshot.nodes.find((item) => item.id === preview.nodeId);
  if (!node) return null;
  const lines = (node.detailsMarkdown ?? node.content)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line !== "---" && !line.startsWith("kb-id:") && !line.startsWith("#"))
    .slice(0, 3);
  const relationCount = snapshot.relations.filter(
    (relation) => relation.source === node.id || relation.target === node.id,
  ).length;
  const sourceStatus = node.status === "missing-source" ? "来源缺失" : node.path ? "Vault 来源" : "账本节点";
  return (
    <div
      className="bg-popover text-popover-foreground pointer-events-none fixed z-[120] w-72 rounded-md border p-3 shadow-lg"
      style={{ left: preview.x, top: preview.y }}
    >
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="h-4 px-1 text-[9px]">
          {node.role}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{node.title}</span>
      </div>
      <div className="text-muted-foreground mt-2 space-y-1 text-[11px] leading-4">
        {(lines.length ? lines : ["暂无正文"]).map((line, index) => (
          <div key={`${node.id}:${index}`} className="line-clamp-1">
            {line}
          </div>
        ))}
      </div>
      <div className="text-muted-foreground mt-2 flex gap-3 border-t pt-2 text-[10px]">
        <span>{relationCount} 条关系</span>
        <span>{sourceStatus}</span>
      </div>
    </div>
  );
}

function AiSettingsPanel({
  value,
  onSave,
}: {
  value: AiConnectionSettings;
  onSave: (settings: AiConnectionSettings) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="text-sm font-medium">AI 连接</div>
        <p className="text-muted-foreground text-xs leading-5">论文桥接和节点桥梁会使用同一 OpenAI 兼容服务。</p>
      </div>
      <div className="space-y-2">
        <label className="text-xs font-medium" htmlFor="kb-ai-endpoint">
          服务地址
        </label>
        <Input
          id="kb-ai-endpoint"
          value={draft.endpoint}
          onChange={(event) => setDraft((current) => ({ ...current, endpoint: event.target.value }))}
          placeholder="https://api.example.com/v1"
          autoComplete="url"
        />
      </div>
      <div className="space-y-2">
        <label className="text-xs font-medium" htmlFor="kb-ai-model">
          模型
        </label>
        <Input
          id="kb-ai-model"
          value={draft.model}
          onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
          placeholder="gpt-4.1-mini"
        />
      </div>
      <div className="space-y-2">
        <label className="text-xs font-medium" htmlFor="kb-ai-key">
          API Key（可选）
        </label>
        <Input
          id="kb-ai-key"
          type="password"
          value={draft.apiKey}
          onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))}
          placeholder="仅保存在当前设备"
          autoComplete="off"
        />
      </div>
      <Button className="w-full" size="sm" onClick={() => onSave(draft)}>
        <SlidersHorizontal />
        保存 AI 设置
      </Button>
      <div className="border-muted-foreground/30 text-muted-foreground border-l pl-2 text-[11px] leading-5">
        连接信息只用于请求你指定的服务。模型结果始终先作为草稿保存，不会自动成为正式关系。
      </div>
    </div>
  );
}

const paperStepLabels: Record<PaperBridgeDraft["chain"][number]["role"], string> = {
  "frontier-concept": "前沿概念",
  "bridge-mechanism": "桥梁机制",
  "learning-anchor": "学习锚点",
  "high-school-anchor": "学习锚点",
  "scale-gap": "尺度鸿沟",
};

const mcpRequestStatusLabels: Record<McpToolRequestStatus, string> = {
  "pending-approval": "待批准",
  completed: "已完成",
  failed: "失败",
  rejected: "已跳过",
};

function PaperBridgePanel({
  snapshot,
  backend,
  connection,
  initialInput,
  onSaveDraft,
  onAdoptDraft,
  onConfigure,
  projectUri,
}: {
  snapshot: VaultSnapshot;
  backend?: KnowledgeBridgeBackend;
  connection: AiConnectionSettings;
  initialInput: string;
  onSaveDraft: (draft: PaperBridgeDraft) => void;
  onAdoptDraft: (draft: PaperBridgeDraft) => boolean;
  onConfigure: () => void;
  projectUri?: string;
}) {
  const [input, setInput] = useState(initialInput);
  const [draft, setDraft] = useState<PaperBridgeDraft | undefined>();
  const [generating, setGenerating] = useState(false);
  const [runningMcp, setRunningMcp] = useState(false);
  const [approvedMcpRequestIds, setApprovedMcpRequestIds] = useState<Set<string>>(() => new Set());
  const draftIsApplied = draft
    ? snapshot.graphProposals.some((proposal) => proposal.sourceDraftId === draft.id && proposal.status === "applied")
    : false;
  const displayedDraft = draft
    ? { ...draft, status: draftIsApplied ? ("adopted" as const) : ("draft" as const) }
    : snapshot.paperDrafts.at(-1);
  const mcpRequests = displayedDraft?.agentTrace?.mcp.requests ?? [];
  const pendingMcpRequests = mcpRequests.filter((request) => request.status === "pending-approval");

  useEffect(() => setApprovedMcpRequestIds(new Set()), [displayedDraft?.id]);

  const generate = async () => {
    if (!backend) {
      toast.error("关系账本尚未就绪，请稍后重试。");
      return;
    }
    setGenerating(true);
    try {
      setDraft(await backend.draft(input, snapshot, connection, projectUri));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "材料草拟失败");
    } finally {
      setGenerating(false);
    }
  };

  const toggleMcpApproval = (requestId: string, approved: boolean) => {
    setApprovedMcpRequestIds((current) => {
      const next = new Set(current);
      if (approved) next.add(requestId);
      else next.delete(requestId);
      return next;
    });
  };

  const runApprovedMcp = async () => {
    if (!displayedDraft || approvedMcpRequestIds.size === 0) return;
    if (!backend) {
      toast.error("关系账本尚未就绪，请稍后重试。");
      return;
    }
    setRunningMcp(true);
    try {
      const next = await backend.runApprovedTools(
        displayedDraft,
        [...approvedMcpRequestIds],
        snapshot,
        connection,
        projectUri,
      );
      setDraft(next);
      setApprovedMcpRequestIds(new Set());
      const completed = next.agentTrace?.mcp.requests?.filter((request) => request.status === "completed").length ?? 0;
      toast.success(`MCP 调用完成：${completed} 项结果已回灌到学习链条。`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "MCP 调用失败");
    } finally {
      setRunningMcp(false);
    }
  };

  const skipPendingMcp = () => {
    if (!displayedDraft?.agentTrace || pendingMcpRequests.length === 0) return;
    const rejected = new Set(pendingMcpRequests.map((request) => request.id));
    setDraft({
      ...displayedDraft,
      agentTrace: {
        ...displayedDraft.agentTrace,
        mcp: {
          ...displayedDraft.agentTrace.mcp,
          requests: rejectPendingMcpRequests(mcpRequests, rejected),
        },
      },
    });
    setApprovedMcpRequestIds(new Set());
  };

  return (
    <div className="space-y-3">
      {!connection.endpoint && (
        <div className="border-muted-foreground/30 flex items-center gap-2 border border-dashed px-3 py-2.5 text-xs">
          <CircleAlert className="text-muted-foreground size-4 shrink-0" />
          <span className="text-muted-foreground min-w-0 flex-1">未连接 AI，生成结果会明确标为本地草拟。</span>
          <Button size="sm" variant="outline" className="h-7 shrink-0 px-2 text-xs" onClick={onConfigure}>
            设置
          </Button>
        </div>
      )}
      <div className="space-y-2">
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="粘贴论文、教材段落、笔记或问题"
          className="min-h-30 resize-y text-sm"
        />
        <Button className="w-full" size="sm" disabled={generating || !input.trim()} onClick={() => void generate()}>
          {generating ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
          {generating ? "正在草拟" : "生成学习链条"}
        </Button>
      </div>

      {displayedDraft && (
        <div className="overflow-hidden rounded-md border">
          <div className="bg-muted/35 flex items-center justify-between border-b px-3 py-2">
            <div className="min-w-0 truncate text-xs font-medium">{displayedDraft.title}</div>
            <Badge variant={displayedDraft.provider === "remote-ai" ? "secondary" : "outline"}>
              {displayedDraft.provider === "remote-ai" ? "AI 草拟" : "本地草拟"}
            </Badge>
          </div>
          <div className="space-y-3 p-3">
            <p className="text-muted-foreground text-xs leading-5">{displayedDraft.summary}</p>
            {displayedDraft.diagnostic && (
              <div className="text-muted-foreground border-muted-foreground/30 border-l pl-2 text-[11px] leading-5">
                {displayedDraft.diagnostic}
              </div>
            )}
            <div className="space-y-2">
              {displayedDraft.chain.map((step, index) => (
                <div key={step.id} className="flex gap-2 text-xs">
                  <div className="flex w-4 shrink-0 flex-col items-center">
                    <span className="bg-foreground mt-1.5 size-1.5 rounded-full" />
                    {index < displayedDraft.chain.length - 1 && <span className="bg-border mt-1 min-h-4 w-px flex-1" />}
                  </div>
                  <div className="min-w-0 pb-2">
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                        {paperStepLabels[step.role]}
                      </Badge>
                      <span className="truncate font-medium">{step.title}</span>
                    </div>
                    <div className="text-muted-foreground mt-1 leading-5">{step.explanation}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-muted-foreground/30 border-l pl-2 text-xs leading-5">
              <span className="font-medium">锚点依据：</span>
              {displayedDraft.anchorReason}
            </div>
            {displayedDraft.agentTrace && (
              <div className="bg-muted/25 space-y-1 border px-2.5 py-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>LLM：{displayedDraft.agentTrace.llm.model ?? displayedDraft.agentTrace.llm.provider}</span>
                  <span>Skills：{displayedDraft.agentTrace.skills.activated.length}</span>
                  <span>
                    MCP：{displayedDraft.agentTrace.mcp.invokedTools.length}/
                    {displayedDraft.agentTrace.mcp.availableTools.length}
                    {pendingMcpRequests.length > 0 ? ` · 待批准 ${pendingMcpRequests.length}` : ""}
                  </span>
                </div>
                {displayedDraft.agentTrace.skills.activated.length > 0 && (
                  <div className="text-muted-foreground truncate">
                    已启用：{displayedDraft.agentTrace.skills.activated.join("、")}
                  </div>
                )}
                {mcpRequests.length > 0 && (
                  <div className="space-y-2 border-t pt-2">
                    {mcpRequests.map((request) => (
                      <div key={request.id} className="flex items-start gap-2">
                        <Checkbox
                          className="mt-0.5"
                          checked={approvedMcpRequestIds.has(request.id)}
                          disabled={request.status !== "pending-approval" || runningMcp}
                          onCheckedChange={(checked) => toggleMcpApproval(request.id, checked === true)}
                          aria-label={`批准调用 ${request.server}/${request.tool}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-medium">
                              {request.server}/{request.tool}
                            </span>
                            <Badge variant="outline" className="h-4 shrink-0 px-1 text-[9px]">
                              {mcpRequestStatusLabels[request.status]}
                            </Badge>
                          </div>
                          <div className="text-muted-foreground mt-0.5 leading-4">{request.reason}</div>
                          {request.resultPreview && (
                            <div className="text-muted-foreground mt-1 line-clamp-2 border-l pl-1.5 break-words">
                              {request.resultPreview}
                            </div>
                          )}
                          {request.error && <div className="mt-1 text-red-500">{request.error}</div>}
                        </div>
                      </div>
                    ))}
                    {pendingMcpRequests.length > 0 && (
                      <div className="flex gap-1.5 pt-1">
                        <Button
                          size="sm"
                          className="h-7 flex-1 text-[11px]"
                          disabled={approvedMcpRequestIds.size === 0 || runningMcp}
                          onClick={() => void runApprovedMcp()}
                        >
                          {runningMcp ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}
                          {runningMcp ? "正在调用" : `批准并调用 (${approvedMcpRequestIds.size})`}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[11px]"
                          disabled={runningMcp}
                          onClick={skipPendingMcp}
                        >
                          全部跳过
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                {displayedDraft.agentTrace.warnings.length > 0 && (
                  <div className="text-amber-500">{displayedDraft.agentTrace.warnings.join("；")}</div>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-2 border-t p-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              disabled={runningMcp}
              onClick={() => onSaveDraft(displayedDraft)}
            >
              保存草稿
            </Button>
            <Button
              size="sm"
              className="flex-1"
              disabled={displayedDraft.status === "adopted" || runningMcp}
              onClick={() => {
                if (onAdoptDraft(displayedDraft)) setDraft((current) => current && { ...current, status: "adopted" });
              }}
            >
              {displayedDraft.status === "adopted" ? "已应用" : "应用到画布"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PendingRow({
  item,
  onResolve,
}: {
  item: PendingMention;
  onResolve: (id: string, action: PendingResolutionAction, candidateId?: string) => void;
}) {
  const Icon =
    item.kind === "lineage"
      ? FileQuestion
      : item.kind === "ai-bridge"
        ? Sparkles
        : item.kind === "scale-gap"
          ? Scale
          : Link2;
  return (
    <div className="border-b px-3 py-2.5 last:border-b-0">
      <div className="flex items-start gap-2">
        <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{item.targetTitle}</span>
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
              {kindLabels[item.kind]}
            </Badge>
          </div>
          <div className="text-muted-foreground mt-1 truncate text-[11px]">{item.filePath}</div>
          <div className="text-muted-foreground mt-1 text-xs leading-5">{item.raw}</div>
        </div>
        {item.kind !== "lineage" && item.kind !== "scale-gap" && item.kind !== "severed-link" && (
          <div className="flex shrink-0 gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              title="采用为待定认知关系"
              onClick={() => onResolve(item.id, "accept")}
            >
              <Check className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              title="忽略"
              onClick={() => onResolve(item.id, "dismiss")}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        )}
      </div>
      {item.kind === "lineage" && (
        <div className="mt-2 ml-6 space-y-2">
          {(item.candidates ?? []).slice(0, 3).map((candidate) => (
            <div key={candidate.id} className="flex items-center gap-2 border-l pl-2 text-xs">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{candidate.title}</div>
                <div className="text-muted-foreground line-clamp-2">{candidate.reason}</div>
              </div>
              <span className="text-muted-foreground tabular-nums">{Math.round(candidate.confidence * 100)}%</span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                onClick={() => onResolve(item.id, "lineage-rebind", candidate.id)}
              >
                重新绑定
              </Button>
            </div>
          ))}
          {(item.candidates?.length ?? 0) === 0 && (
            <div className="text-muted-foreground border-l pl-2 text-[11px]">没有足够可靠的旧节点候选。</div>
          )}
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 flex-1 text-[11px]"
              onClick={() => onResolve(item.id, "lineage-new")}
            >
              确认为新节点
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              onClick={() => onResolve(item.id, "lineage-defer")}
            >
              {item.deferredAt ? "继续暂存" : "暂不处理"}
            </Button>
          </div>
        </div>
      )}
      {item.kind === "scale-gap" && (
        <div className="text-muted-foreground mt-2 ml-6 border-l pl-2 text-[11px]">
          补全并确认尺度换算协议后，该任务会自动解除；不能直接确认为强因果关系。
        </div>
      )}
      {item.kind === "severed-link" && (
        <div className="mt-2 ml-6 flex items-center gap-2">
          <div className="text-muted-foreground min-w-0 flex-1 text-[11px]">保持剪断不会影响历史记录。</div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            onClick={() => onResolve(item.id, "restore-managed-link")}
          >
            <ArchiveRestore />
            恢复链接
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={() => onResolve(item.id, "dismiss")}
          >
            保留剪断
          </Button>
        </div>
      )}
    </div>
  );
}

function PendingPool({
  items,
  onResolve,
}: {
  items: PendingMention[];
  onResolve: (id: string, action: PendingResolutionAction, candidateId?: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="bg-muted/35 flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-medium">
          <Search className="size-3.5" />
          待整理
        </div>
        <Badge variant="secondary">{items.length}</Badge>
      </div>
      {items.length > 0 ? (
        items.map((item) => <PendingRow key={item.id} item={item} onResolve={onResolve} />)
      ) : (
        <div className="text-muted-foreground px-3 py-8 text-center text-xs">待定池已清空</div>
      )}
    </div>
  );
}

function BridgeSuggestions({
  snapshot,
  connection,
  onFreeze,
  onAdoptSuggestion,
  onApplyMigration,
}: {
  snapshot: VaultSnapshot;
  connection: AiConnectionSettings;
  onFreeze: (l2Id: string) => void;
  onAdoptSuggestion: (nodeId: string, suggestion: BridgeSuggestion) => void;
  onApplyMigration: (preview: ReturnType<typeof buildFrozenL2MigrationPreview>, pathIds: Set<string>) => void;
}) {
  const anchor = snapshot.nodes.find(
    (node) =>
      node.role === "L1" &&
      node.status !== "missing-source" &&
      node.status !== "frozen" &&
      node.sourceKind !== "denied",
  );
  const l2Nodes = snapshot.nodes.filter((node) => node.role === "L2");
  const frozenL2 = l2Nodes.find((node) => node.status === "frozen");
  const l3Nodes = snapshot.nodes.filter(
    (node) => node.role === "L3" && node.status !== "missing-source" && node.status !== "frozen",
  );
  const [selectedNodeId, setSelectedNodeId] = useState(l3Nodes[0]?.id ?? "");
  const [suggestion, setSuggestion] = useState<BridgeSuggestion>();
  const [suggestionError, setSuggestionError] = useState<string>();
  const [suggesting, setSuggesting] = useState(false);
  useEffect(() => {
    if (!l3Nodes.some((node) => node.id === selectedNodeId)) setSelectedNodeId(l3Nodes[0]?.id ?? "");
  }, [l3Nodes, selectedNodeId]);
  useEffect(() => {
    setSuggestion(undefined);
    setSuggestionError(undefined);
  }, [selectedNodeId]);
  const preview = useMemo(
    () => (frozenL2 ? buildFrozenL2MigrationPreview(snapshot, frozenL2.id, 0) : undefined),
    [frozenL2?.id, snapshot],
  );
  const eligiblePathIds = useMemo(
    () =>
      new Set(
        (preview?.paths ?? []).flatMap((entry) => {
          const best = entry.candidates[0];
          return best && best.confidence >= 0.8 && !best.conflict ? [entry.path.id] : [];
        }),
      ),
    [preview],
  );
  const [selectedPathIds, setSelectedPathIds] = useState<Set<string>>(() => new Set());
  useEffect(() => setSelectedPathIds(new Set(eligiblePathIds)), [eligiblePathIds]);
  const pathFamilies = useMemo(() => {
    const grouped = new Map<string, NonNullable<typeof preview>["paths"]>();
    for (const entry of preview?.paths ?? []) {
      const entries = grouped.get(entry.path.family) ?? [];
      entries.push(entry);
      grouped.set(entry.path.family, entries);
    }
    return [...grouped.entries()];
  }, [preview]);
  const highConfidenceCount = eligiblePathIds.size;
  const togglePath = (pathId: string, checked: boolean) => {
    setSelectedPathIds((current) => {
      const next = new Set(current);
      if (checked) next.add(pathId);
      else next.delete(pathId);
      return next;
    });
  };
  const toggleFamily = (pathIds: string[], checked: boolean) => {
    setSelectedPathIds((current) => {
      const next = new Set(current);
      for (const pathId of pathIds) {
        if (!eligiblePathIds.has(pathId)) continue;
        if (checked) next.add(pathId);
        else next.delete(pathId);
      }
      return next;
    });
  };
  const generateSuggestion = async () => {
    const selected = snapshot.nodes.find((node) => node.id === selectedNodeId);
    if (!selected) return;
    setSuggesting(true);
    setSuggestion(undefined);
    setSuggestionError(undefined);
    try {
      const next = await suggestBridge(selected, snapshot.nodes, connection);
      setSuggestion(next);
      if (next.diagnostic) toast.warning(next.diagnostic);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSuggestionError(message);
      toast.error(`桥梁建议生成失败：${message}`);
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-md border">
        <div className="bg-muted/35 flex items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-medium">
            <Sparkles className="size-3.5" />
            AI 搭桥草稿
          </div>
          <Badge variant="outline">{connection.endpoint ? "远程 AI" : "本地草拟"}</Badge>
        </div>
        <div className="space-y-2 p-3">
          <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto">
            {l3Nodes.map((node) => (
              <Button
                key={node.id}
                size="sm"
                variant={selectedNodeId === node.id ? "secondary" : "ghost"}
                className="h-6 max-w-full px-2 text-[10px]"
                onClick={() => setSelectedNodeId(node.id)}
              >
                <span className="truncate">{node.title}</span>
              </Button>
            ))}
          </div>
          <Button
            className="w-full"
            size="sm"
            disabled={!selectedNodeId || suggesting}
            onClick={() => void generateSuggestion()}
          >
            {suggesting ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
            {suggesting ? "正在比较机制" : "生成桥梁建议"}
          </Button>
          {(suggestionError || suggestion?.diagnostic) && (
            <div
              className={
                suggestionError
                  ? "border-destructive/40 bg-destructive/10 text-destructive flex items-start gap-2 border px-2.5 py-2 text-[11px] leading-4"
                  : "flex items-start gap-2 border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-4 text-amber-700 dark:text-amber-300"
              }
              role="status"
            >
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>{suggestionError ?? suggestion?.diagnostic}</span>
            </div>
          )}
          {suggestion && (
            <div className="space-y-2 border-t pt-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">
                  L2 {snapshot.nodes.find((node) => node.id === suggestion.bridgeId)?.title ?? suggestion.bridgeTitle}
                </span>
                <Badge variant="outline">{suggestion.isNewBridge ? "新候选" : "复用"}</Badge>
                <Badge variant="secondary">{Math.round(suggestion.confidence * 100)}%</Badge>
              </div>
              <div className="text-muted-foreground leading-5">{suggestion.reason}</div>
              {suggestion.isNewBridge && (suggestion.bridgeDefinition || suggestion.bridgeBoundary) && (
                <div className="bg-muted/30 space-y-1 border-l px-2 py-1.5 text-[11px] leading-4">
                  {suggestion.bridgeDefinition && <div>定义：{suggestion.bridgeDefinition}</div>}
                  {suggestion.bridgeScope && <div>范围：{suggestion.bridgeScope}</div>}
                  {suggestion.bridgeBoundary && <div>边界：{suggestion.bridgeBoundary}</div>}
                </div>
              )}
              <div className="border-l pl-2">
                <div className="font-medium">
                  L1 {snapshot.nodes.find((node) => node.id === suggestion.anchorId)?.title ?? "无可用锚点"}
                </div>
                <div className="text-muted-foreground mt-1 leading-4">{suggestion.anchorReason}</div>
                {suggestion.anchorEvidence.length > 0 && (
                  <div className="text-muted-foreground mt-1">依据：{suggestion.anchorEvidence.join("、")}</div>
                )}
              </div>
              {(suggestion.alternatives.length > 0 || suggestion.anchorAlternatives.length > 0) && (
                <div className="text-muted-foreground text-[11px] leading-4">
                  备选机制：
                  {suggestion.alternatives
                    .map((item) => snapshot.nodes.find((node) => node.id === item.id)?.title ?? item.id)
                    .join("、") || "无"}
                  <br />
                  备选锚点：
                  {suggestion.anchorAlternatives
                    .map((item) => snapshot.nodes.find((node) => node.id === item.id)?.title ?? item.id)
                    .join("、") || "无"}
                </div>
              )}
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => onAdoptSuggestion(selectedNodeId, suggestion)}
              >
                采用为待确认路径
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-md border">
        <div className="bg-muted/35 flex items-center gap-2 border-b px-3 py-2 text-xs font-medium">
          <Bot className="size-3.5" />
          锚点选择依据
        </div>
        <div className="space-y-2 p-3 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">L1 {anchor?.title ?? "尚未建立锚点"}</span>
            <Badge>{anchor?.sourceKind === "user-confirmed" ? "用户确认" : "草拟"}</Badge>
          </div>
          <div className="text-muted-foreground leading-5">
            {anchor?.anchorLedger?.at(-1)?.rationale ?? "AI 只能提出锚点候选，不能自动写入正式画像。"}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(anchor?.anchorLedger?.at(-1)?.evidence ?? []).map((evidence) => (
              <Badge key={evidence} variant="outline">
                {evidence}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border">
        <div className="bg-muted/35 flex items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-medium">
            <GitBranch className="size-3.5" />
            L2 替代候选
          </div>
          <Badge variant="secondary">{frozenL2 ? "迁移预览" : "准入检查"}</Badge>
        </div>
        {frozenL2 && preview ? (
          <>
            <div className="space-y-1 border-b px-3 py-2.5 text-xs">
              <div className="font-medium">历史路径 ×{preview.paths.length}</div>
              <div className="text-muted-foreground">
                可迁移 {highConfidenceCount}/{preview.paths.length} 条（
                {preview.paths.length ? Math.round((highConfidenceCount / preview.paths.length) * 100) : 0}%），当前选择
                {selectedPathIds.size} 条；其余继续冻结。
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {pathFamilies.map(([family, entries]) => {
                const eligibleFamilyIds = entries
                  .map((entry) => entry.path.id)
                  .filter((pathId) => eligiblePathIds.has(pathId));
                const familyChecked =
                  eligibleFamilyIds.length > 0 && eligibleFamilyIds.every((pathId) => selectedPathIds.has(pathId));
                return (
                  <details key={family} className="border-b last:border-b-0">
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs">
                      <Checkbox
                        checked={familyChecked}
                        disabled={eligibleFamilyIds.length === 0}
                        onCheckedChange={(checked) => toggleFamily(eligibleFamilyIds, checked === true)}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={`选择路径族 ${family}`}
                      />
                      <span className="min-w-0 flex-1 truncate font-medium">{family}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {eligibleFamilyIds.length}/{entries.length}
                      </span>
                    </summary>
                    <div className="border-t">
                      {entries.map((entry) => {
                        const best = entry.candidates[0];
                        const eligible = eligiblePathIds.has(entry.path.id);
                        const l1 = snapshot.nodes.find((node) => node.id === entry.path.l1Id)?.title ?? entry.path.l1Id;
                        const l3 = snapshot.nodes.find((node) => node.id === entry.path.l3Id)?.title ?? entry.path.l3Id;
                        return (
                          <div key={entry.path.id} className="space-y-1.5 border-b px-3 py-2 last:border-b-0">
                            <div className="flex items-center gap-2 text-xs">
                              <Checkbox
                                checked={selectedPathIds.has(entry.path.id)}
                                disabled={!eligible}
                                onCheckedChange={(checked) => togglePath(entry.path.id, checked === true)}
                                aria-label={`选择 ${l1} 到 ${l3} 的迁移`}
                              />
                              <span className="min-w-0 flex-1 truncate">
                                {l1} → {l3}
                              </span>
                              <span className="text-muted-foreground tabular-nums">
                                {best ? `${Math.round(best.confidence * 100)}%` : "冻结"}
                              </span>
                            </div>
                            {entry.candidates.slice(0, 3).map((candidate, index) => (
                              <div
                                key={`${entry.path.id}:${candidate.l2Id}`}
                                className="text-muted-foreground ml-6 text-[11px] leading-4"
                              >
                                {index + 1}.{" "}
                                {snapshot.nodes.find((node) => node.id === candidate.l2Id)?.title ?? candidate.l2Id}
                                {` · 语义损失 ${candidate.semanticLoss}`}
                                {candidate.conditionChange ? ` · ${candidate.conditionChange}` : ""}
                                {candidate.conflict ? ` · ${candidate.conflict}` : ""}
                                <span className="block">{candidate.reason}</span>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </details>
                );
              })}
              {preview.paths.length === 0 && (
                <div className="text-muted-foreground px-3 py-5 text-center text-xs">
                  旧账本没有可核验的实际路径标识，系统不会制造 L1×L3 组合。
                </div>
              )}
            </div>
            <div className="p-2">
              <Button
                size="sm"
                className="w-full"
                disabled={selectedPathIds.size === 0}
                onClick={() => onApplyMigration(preview, selectedPathIds)}
              >
                应用已选替代（{selectedPathIds.size}）
              </Button>
            </div>
          </>
        ) : (
          l2Nodes
            .filter((node) => node.status !== "frozen")
            .map((node) => {
              const report = evaluateL2Admission(snapshot, node.id);
              return (
                <div key={node.id} className="flex items-center gap-2 border-b px-3 py-2.5 last:border-b-0">
                  <span className="min-w-0 flex-1 text-sm">{node.title}</span>
                  <span className="text-muted-foreground text-xs">{report.independentPathCount} 路径</span>
                  <Badge variant={report.qualified ? "secondary" : "outline"}>
                    {report.qualified ? "可复核" : "待补充"}
                  </Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    title={`冻结 ${node.title}`}
                    onClick={() => onFreeze(node.id)}
                  >
                    <ArchiveRestore className="size-3.5" />
                  </Button>
                </div>
              );
            })
        )}
      </div>

      <div className="border-muted-foreground/30 flex items-center gap-2 rounded-md border border-dashed px-3 py-2.5">
        <CircleAlert className="text-muted-foreground size-4" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium">L3 生命周期</div>
          <div className="text-muted-foreground text-[11px]">
            {snapshot.nodes.filter((node) => node.role === "L3" && node.l3Lifecycle === "captured").length}{" "}
            个已捕获占位符保持静默，直到再次相关。
          </div>
        </div>
      </div>
    </div>
  );
}

function EvidencePanel({
  snapshot,
  onSelectLens,
}: {
  snapshot: VaultSnapshot;
  onSelectLens: (lensId: string) => void;
}) {
  const readings = snapshot.relations.flatMap((relation) =>
    (relation.evidence ?? []).map((reading) => ({ relation, reading })),
  );
  const supportLevels = [
    ...new Set(
      readings.filter(({ reading }) => reading.direction !== "challenges").map(({ reading }) => reading.level),
    ),
  ];
  const challengeLevels = [
    ...new Set(readings.filter(({ reading }) => reading.direction !== "supports").map(({ reading }) => reading.level)),
  ];
  const hasTension =
    readings.some(({ reading }) => reading.direction === "mixed") ||
    (supportLevels.length > 0 && challengeLevels.length > 0);
  const bundledRelations = relationBundles(snapshot);
  const hiddenCognitiveCount = bundledRelations.reduce((count, bundle) => count + bundle.hiddenCognitiveCount, 0);
  const bundledLogicalCount = bundledRelations.reduce(
    (count, bundle) => count + Math.max(0, bundle.logical.length - 1),
    0,
  );
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-md border">
        <div className="bg-muted/35 flex items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-medium">
            <ShieldCheck className="size-3.5" />
            证据张力线
          </div>
          <Badge variant="outline">
            {readings.length ? (hasTension ? "张力共存" : `${readings.length} 项评价`) : "暂无评价"}
          </Badge>
        </div>
        <div className="space-y-3 p-3">
          <div
            className={
              hasTension
                ? "h-0.5 w-full bg-[linear-gradient(90deg,#3b82f6_0_45%,transparent_45%_55%,#ef4444_55%_100%)]"
                : "bg-muted h-0.5 w-full"
            }
          />
          {readings.length > 0 ? (
            <div className="space-y-2 text-xs">
              {readings.map(({ relation, reading }, index) => {
                const lens = snapshot.lenses.find((item) => item.id === reading.lensId);
                const source = snapshot.nodes.find((node) => node.id === relation.source)?.title ?? relation.source;
                const target = snapshot.nodes.find((node) => node.id === relation.target)?.title ?? relation.target;
                return (
                  <div
                    key={`${relation.id}:${reading.perspective}:${reading.direction}:${index}`}
                    className="border-l pl-2"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={
                          reading.direction === "challenges"
                            ? "font-medium text-red-400"
                            : reading.direction === "mixed"
                              ? "font-medium text-amber-400"
                              : "font-medium text-blue-400"
                        }
                      >
                        {reading.level}{" "}
                        {reading.direction === "challenges" ? "反驳" : reading.direction === "mixed" ? "双向" : "支持"}
                      </span>
                      <Badge variant="outline" className="h-4 px-1 text-[9px]">
                        {reading.perspective}
                      </Badge>
                      {lens && (
                        <Badge variant={lens.active ? "secondary" : "outline"} className="h-4 px-1 text-[9px]">
                          {lens.title}
                        </Badge>
                      )}
                      {reading.evaluatedAt && (
                        <span className="text-muted-foreground">
                          {new Date(reading.evaluatedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <div className="text-muted-foreground mt-1">
                      {source} → {target}
                    </div>
                    <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px]">
                      <span>直接性：{reading.directness ?? "未判定"}</span>
                      <span>方法：{reading.methodQuality ?? "未判定"}</span>
                      <span>复核：{reading.verifiability ?? "未判定"}</span>
                      <span>范围：{reading.applicability ?? "未注明"}</span>
                    </div>
                    {reading.note && <div className="text-muted-foreground mt-1 leading-4">{reading.note}</div>}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-muted-foreground py-2 text-center text-xs">尚未建立证据评价</div>
          )}
          {readings.length > 0 && (
            <div className="text-muted-foreground text-[11px]">
              支持：{supportLevels.join("、") || "无"}；反驳：{challengeLevels.join("、") || "无"}
              。各视角独立保存，不做平均。
            </div>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-md border">
        <div className="bg-muted/35 flex items-center gap-2 border-b px-3 py-2 text-xs font-medium">
          <Scale className="size-3.5" />
          尺度换算协议
        </div>
        <div className="divide-y">
          {snapshot.protocols.map((protocol) => (
            <div key={protocol.id} className="p-3">
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="outline">{protocol.sourceScale}</Badge>
                <span className="text-muted-foreground">→</span>
                <Badge variant="outline">{protocol.targetScale}</Badge>
                <Badge className="ml-auto" variant={protocol.status === "confirmed" ? "secondary" : "outline"}>
                  {protocol.status === "confirmed" ? "已确认" : "尺度鸿沟"}
                </Badge>
              </div>
              <div className="text-muted-foreground mt-2 text-xs leading-5">
                {protocol.mechanismSteps.join(" → ") || "需要补充中间机制"}
              </div>
              {protocol.boundary && (
                <div className="text-muted-foreground mt-1 border-l pl-2 text-[11px]">边界：{protocol.boundary}</div>
              )}
            </div>
          ))}
          {snapshot.protocols.length === 0 && (
            <div className="text-muted-foreground px-3 py-5 text-center text-xs">尚未建立尺度换算协议</div>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-md border">
        <div className="bg-muted/35 flex items-center gap-2 border-b px-3 py-2 text-xs font-medium">
          <Scale className="size-3.5" />
          知识镜头
        </div>
        <div className="flex flex-wrap gap-1.5 p-3">
          {snapshot.lenses.map((lens) => (
            <Button
              key={lens.id}
              size="sm"
              variant={lens.active ? "secondary" : "outline"}
              className="h-7 px-2 text-xs"
              onClick={() => onSelectLens(lens.id)}
            >
              {lens.title}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-md border px-3 py-2.5">
        <CircleAlert className="size-4 text-amber-400" />
        <div className="min-w-0 flex-1 text-xs">
          <span className="font-medium">关系束</span>
          <span className="text-muted-foreground ml-2">
            {bundledLogicalCount} 条逻辑关系已折叠，{hiddenCognitiveCount} 条认知脚手架默认隐藏
          </span>
        </div>
      </div>
    </div>
  );
}

export default function KnowledgeBridgeWindow({
  initialVaultName = "跨学科知识库",
  initialInput = "",
  initialAnchor,
  freshStart = false,
}: KnowledgeBridgeLaunchOptions = {}) {
  const activeResourceTab = useAtomValue(activeResourceTabAtom);
  const activeProject =
    activeResourceTab && "stageManager" in activeResourceTab ? (activeResourceTab as Project) : undefined;
  const [snapshot, setSnapshot] = useState<VaultSnapshot>(() => createStarterSnapshot(initialAnchor));
  const starterSnapshotRef = useRef(snapshot);
  const [vaultName, setVaultName] = useState(initialVaultName);
  const [persistenceMode, setPersistenceMode] = useState<"browser" | "vault">("browser");
  const [ledgerStatus, setLedgerStatus] = useState<LedgerStatus>("loading");
  const [ledgerError, setLedgerError] = useState<string>();
  const [ledgerAttempt, setLedgerAttempt] = useState(0);
  const [activeTab, setActiveTab] = useState("paper");
  const [aiConnection, setAiConnection] = useState<AiConnectionSettings>(() => loadAiConnection());
  const [anchorInput, setAnchorInput] = useState("");
  const [indexProgress, setIndexProgress] = useState<IndexProgress>({ phase: "idle", current: 0, total: 0 });
  const [hoverPreview, setHoverPreview] = useState<HoverPreviewState>();
  const snapshotRef = useRef(snapshot);
  const ledgerRef = useRef<GraphLedger | undefined>(undefined);
  const backendRef = useRef<LocalKnowledgeBridgeBackend | undefined>(undefined);
  const adapterRef = useRef<VaultAdapter>(new DemoVaultAdapter());
  const ledgerWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const ledgerEpochRef = useRef(0);
  const scanControllerRef = useRef<AbortController | undefined>(undefined);
  const scanning = indexProgress.phase === "scanning";
  const vaultBacked = persistenceMode === "vault";
  const mutationDisabled = ledgerStatus !== "ready";
  const ledgerBusy = ledgerStatus === "loading" || ledgerStatus === "saving";
  const ledgerStatusLabel =
    ledgerStatus === "loading"
      ? "恢复中"
      : ledgerStatus === "saving"
        ? "保存中"
        : ledgerStatus === "error"
          ? "保存失败"
          : scanning
            ? "索引中"
            : "已保存";
  const progressValue =
    scanning && indexProgress.total === 0
      ? undefined
      : indexProgress.total > 0
        ? Math.round((indexProgress.current / indexProgress.total) * 100)
        : 100;

  useEffect(() => {
    if (ledgerStatus !== "ready" || !activeProject) return;
    let cancelled = false;
    void import("@/knowledge-bridge/canvas").then(({ synchronizeKnowledgeBridgeCanvas }) => {
      if (!cancelled) synchronizeKnowledgeBridgeCanvas(activeProject, snapshot);
    });
    return () => {
      cancelled = true;
    };
  }, [activeProject, ledgerStatus, snapshot]);

  useEffect(() => {
    if (ledgerStatus !== "ready" || !activeProject) return;
    const canvas = activeProject.canvas.element;
    let timer: number | undefined;
    let hoveredNodeId: string | undefined;
    const close = () => {
      hoveredNodeId = undefined;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      setHoverPreview(undefined);
    };
    const onMove = (event: MouseEvent) => {
      const world = activeProject.renderer.transformView2World(new Vector(event.clientX, event.clientY));
      const entity = activeProject.stageManager.findEntityByLocation(world);
      const uuid = entity?.uuid ?? "";
      const nodeId = uuid.startsWith("kb:node:") ? uuid.slice("kb:node:".length) : undefined;
      if (nodeId === hoveredNodeId) return;
      close();
      if (!nodeId) return;
      hoveredNodeId = nodeId;
      const x = Math.max(8, Math.min(window.innerWidth - 304, event.clientX + 16));
      const y = Math.max(8, Math.min(window.innerHeight - 150, event.clientY + 16));
      timer = window.setTimeout(() => {
        if (hoveredNodeId === nodeId) setHoverPreview({ nodeId, x, y });
      }, 800);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", close);
    canvas.addEventListener("wheel", close, { passive: true });
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      close();
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", close);
      canvas.removeEventListener("wheel", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activeProject, ledgerStatus]);

  const commitSnapshot = (
    next: VaultSnapshot,
    kind: string,
    operation?: KnowledgeGraphOperationMeta,
    sideEffects?: LedgerSideEffects,
  ): boolean => {
    const backend = backendRef.current;
    if (!backend) {
      toast.error("关系账本尚未就绪，请稍后重试。");
      return false;
    }
    try {
      const persisted = backend.commit({ snapshot: next, kind, operation, sideEffects });
      snapshotRef.current = persisted;
      setSnapshot(persisted);
      return true;
    } catch (error) {
      const message = String(error);
      setLedgerError(message);
      setLedgerStatus("error");
      toast.error(`无法保存关系账本：${message}`);
      return false;
    }
  };

  useEffect(() => {
    if (ledgerStatus !== "ready" || !activeProject) return;
    let cancelled = false;
    let timer: number | undefined;
    let detailsTimer: number | undefined;
    let pendingDetailsSignature = "";
    let lastCommittedDetailsSignature = "";
    void import("@/knowledge-bridge/canvas").then(
      ({
        readChangedKnowledgeBridgeCanvasDetails,
        readKnowledgeBridgeCanvasPositions,
        updateKnowledgeBridgeSemanticZoom,
      }) => {
        const persistDetails = async () => {
          const backend = backendRef.current;
          if (!backend || cancelled) return;
          const details = readChangedKnowledgeBridgeCanvasDetails(activeProject);
          if (details.length === 0) return;
          const signature = JSON.stringify(details);
          if (signature === lastCommittedDetailsSignature) return;
          const fileWrites: NonNullable<LedgerSideEffects["fileWrites"]> = [];
          try {
            for (const detail of details) {
              const node = snapshotRef.current.nodes.find((item) => item.id === detail.id);
              if (!node?.path) continue;
              const before = await adapterRef.current.read(node.path);
              const after = mergeMarkdownBody(before, detail.markdown, node.id);
              if (before === after) continue;
              await adapterRef.current.write(node.path, after);
              fileWrites.push({ path: node.path, before, after });
            }
            const applied = backend.applyOperation(snapshotRef.current, createNodeDetailsOperation(details), {
              fileWrites,
            });
            if (applied.changed) {
              lastCommittedDetailsSignature = signature;
              snapshotRef.current = applied.snapshot;
              setSnapshot(applied.snapshot);
            }
          } catch (error) {
            await Promise.all(fileWrites.map((write) => adapterRef.current.write(write.path, write.before)));
            toast.error(`知识详情保存失败：${String(error)}`);
          }
        };

        const persistCanvas = () => {
          if (cancelled) return;
          updateKnowledgeBridgeSemanticZoom(activeProject);
          // Keep the canvas object under the pointer while dragging. Persisting
          // coordinates mid-drag causes a React/ledger synchronization pass that
          // can rebuild graph references before the pointer is released.
          if (activeProject.controller.isMouseDown[0]) return;
          const backend = backendRef.current;
          if (!backend) return;
          const positionOperation = createCanvasPositionOperation(readKnowledgeBridgeCanvasPositions(activeProject));
          const applied = backend.applyOperation(snapshotRef.current, positionOperation);
          if (applied.changed) {
            snapshotRef.current = applied.snapshot;
            setSnapshot(applied.snapshot);
          }

          const details = readChangedKnowledgeBridgeCanvasDetails(activeProject);
          const signature = details.length ? JSON.stringify(details) : "";
          if (!signature) {
            pendingDetailsSignature = "";
            if (detailsTimer !== undefined) window.clearTimeout(detailsTimer);
            detailsTimer = undefined;
          } else if (signature !== pendingDetailsSignature && signature !== lastCommittedDetailsSignature) {
            pendingDetailsSignature = signature;
            if (detailsTimer !== undefined) window.clearTimeout(detailsTimer);
            detailsTimer = window.setTimeout(() => void persistDetails(), 800);
          }
        };
        persistCanvas();
        timer = window.setInterval(persistCanvas, 350);
      },
    );
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
      if (detailsTimer !== undefined) window.clearTimeout(detailsTimer);
    };
  }, [activeProject, ledgerStatus]);

  const enqueueLedgerWrite = (adapter: VaultAdapter, bytes: Uint8Array): Promise<void> => {
    setLedgerStatus("saving");
    const write = ledgerWriteQueueRef.current
      .catch(() => undefined)
      .then(() => adapter.writeBinary(KNOWLEDGE_BRIDGE_LEDGER_PATH, bytes));
    ledgerWriteQueueRef.current = write;
    void write
      .then(() => {
        if (ledgerWriteQueueRef.current !== write) return;
        setLedgerError(undefined);
        setLedgerStatus("ready");
      })
      .catch((error: unknown) => {
        if (ledgerWriteQueueRef.current !== write) return;
        const message = String(error);
        setLedgerError(message);
        setLedgerStatus("error");
        toast.error(`无法保存关系账本：${message}`);
      });
    return write;
  };

  useEffect(() => {
    let disposed = false;
    const epoch = ++ledgerEpochRef.current;
    ledgerRef.current = undefined;
    backendRef.current = undefined;
    setLedgerError(undefined);
    setLedgerStatus("loading");

    void (async () => {
      await ledgerWriteQueueRef.current.catch(() => undefined);
      ledgerWriteQueueRef.current = Promise.resolve();

      let recentVault: Awaited<ReturnType<typeof restoreRecentVault>>;
      let recentVaultError: unknown;
      try {
        recentVault = await restoreRecentVault();
      } catch (error) {
        recentVaultError = error;
      }
      if (disposed || epoch !== ledgerEpochRef.current) return;

      if (recentVault) {
        try {
          const bytes = await recentVault.readBinary(KNOWLEDGE_BRIDGE_LEDGER_PATH);
          const ledger = await GraphLedger.open(
            bytes && bytes.length > 0 ? bytes : undefined,
            (nextBytes) => enqueueLedgerWrite(recentVault, nextBytes),
            false,
          );
          if (disposed || epoch !== ledgerEpochRef.current) return;
          ledgerRef.current = ledger;
          backendRef.current = new LocalKnowledgeBridgeBackend(ledger);
          const saved = ledger.load();
          const next = hasSnapshotContent(saved)
            ? appendInitialAnchor(saved, initialAnchor)
            : starterSnapshotRef.current;
          adapterRef.current = recentVault;
          setVaultName(recentVault.name);
          setPersistenceMode("vault");
          snapshotRef.current = next;
          setSnapshot(next);
          setLedgerStatus("ready");
          if (next !== saved) {
            backendRef.current.commit({
              snapshot: next,
              kind: hasSnapshotContent(saved) ? "resume-with-anchor" : "vault-create",
            });
          }
          toast.message(`已恢复 ${recentVault.name}，新材料会基于已有锚点继续桥接。`);
          void startScan(recentVault);
          return;
        } catch (error) {
          recentVaultError = error;
        }
      }

      const ledger = await GraphLedger.open();
      if (disposed || epoch !== ledgerEpochRef.current) return;
      ledgerRef.current = ledger;
      backendRef.current = new LocalKnowledgeBridgeBackend(ledger);
      adapterRef.current = new DemoVaultAdapter();
      setVaultName(initialVaultName);
      setPersistenceMode("browser");
      const saved = ledger.load();
      let next: VaultSnapshot;
      if (hasSnapshotContent(saved) && !(freshStart && isBundledBiologyDemo(saved))) {
        next = appendInitialAnchor(saved, initialAnchor);
      } else {
        next = starterSnapshotRef.current;
      }
      snapshotRef.current = next;
      setSnapshot(next);
      setLedgerStatus("ready");
      if (next !== saved || !hasSnapshotContent(saved)) {
        backendRef.current.commit({
          snapshot: next,
          kind: hasSnapshotContent(saved) ? "resume-with-anchor" : freshStart ? "welcome-start" : "initial-empty",
        });
      }
      if (recentVaultError) {
        toast.warning(`最近的 Vault 无法恢复，已切换到本地持久账本：${String(recentVaultError)}`);
      }
    })().catch((error: unknown) => {
      if (disposed || epoch !== ledgerEpochRef.current) return;
      const message = String(error);
      ledgerRef.current = undefined;
      backendRef.current = undefined;
      setLedgerError(message);
      setLedgerStatus("error");
      toast.error(`关系账本打开失败：${message}`);
    });
    return () => {
      disposed = true;
      scanControllerRef.current?.abort();
    };
  }, [ledgerAttempt]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;

    let disposed = false;
    let closeStarted = false;
    let unlisten: (() => void) | undefined;

    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        const appWindow = getCurrentWindow();
        return appWindow.onCloseRequested(async (event) => {
          event.preventDefault();
          if (closeStarted) return;
          closeStarted = true;
          scanControllerRef.current?.abort();

          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          try {
            const flushWrites = async () => {
              let pendingWrite: Promise<void>;
              do {
                pendingWrite = ledgerWriteQueueRef.current;
                await pendingWrite;
              } while (pendingWrite !== ledgerWriteQueueRef.current);
            };
            const timeout = new Promise<void>((_, reject) => {
              timeoutId = setTimeout(() => reject(new Error("Ledger flush timed out after 8 seconds")), 8_000);
            });
            await Promise.race([flushWrites(), timeout]);
          } catch (error) {
            console.error("Knowledge Bridge ledger flush failed while closing", error);
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
          }

          try {
            await appWindow.destroy();
          } catch (error) {
            closeStarted = false;
            console.error("Knowledge Bridge window destroy failed", error);
          }
        });
      })
      .then((stopListening) => {
        if (disposed) stopListening();
        else unlisten = stopListening;
      })
      .catch((error: unknown) => console.error("Knowledge Bridge close handler failed", error));

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  async function startScan(adapter = adapterRef.current) {
    scanControllerRef.current?.abort();
    const controller = new AbortController();
    scanControllerRef.current = controller;
    setIndexProgress({ phase: "scanning", current: 0, total: 0 });
    try {
      const ledger = ledgerRef.current;
      const cached = ledger?.getMetadata<IndexedFile[]>(INDEX_CACHE_METADATA_KEY) ?? [];
      const incremental = await indexVaultIncrementally(adapter, cached, controller.signal, setIndexProgress);
      if (controller.signal.aborted) {
        setIndexProgress({ phase: "cancelled", current: 0, total: incremental.indexed.length });
        return;
      }
      const indexed = incremental.indexed;
      const current = snapshotRef.current;
      const managedSnapshots = ledger?.listSnapshots() ?? [];
      const indexedByPath = new Map(indexed.map((file) => [file.path, file]));
      const changedByPath = new Map(incremental.changedFiles.map((file) => [file.path, file]));
      const sourceHydrationFiles = (
        await Promise.all(
          current.nodes
            .filter(
              (node) =>
                node.path &&
                node.detailsMarkdown === undefined &&
                indexedByPath.has(node.path) &&
                !changedByPath.has(node.path),
            )
            .map(async (node) => {
              const metadata = indexedByPath.get(node.path!);
              if (!metadata) return undefined;
              return {
                path: node.path!,
                content: await adapter.read(node.path!),
                modifiedAt: metadata.modifiedAt,
                size: metadata.size,
              };
            }),
        )
      ).filter((file): file is VaultFile => file !== undefined);
      const sourceFiles = [...incremental.changedFiles, ...sourceHydrationFiles];
      const managedFiles = (
        await Promise.all(
          [...new Set(managedSnapshots.map((item) => item.filePath))].map(async (path) => {
            const metadata = indexedByPath.get(path);
            if (!metadata) return undefined;
            const changed = changedByPath.get(path);
            return (
              changed ?? {
                path,
                content: await adapter.read(path),
                modifiedAt: metadata.modifiedAt,
                size: metadata.size,
              }
            );
          }),
        )
      ).filter((file): file is VaultFile => file !== undefined);
      const reconciled = await reconcileVaultManagedLinks(current, managedFiles, managedSnapshots);
      const base = markMissingSources(syncChangedNodeSources(reconciled.snapshot, sourceFiles), indexed);
      const discovered = toPending(indexed, new Set(base.nodes.map((node) => node.id)), base);
      const merged = new Map(base.pending.map((item) => [item.id, item]));
      for (const item of discovered) merged.set(item.id, item);
      if (
        commitSnapshot({ ...base, pending: [...merged.values()] }, "vault-index", undefined, {
          deleteLinkSnapshotIds: reconciled.deleteLinkSnapshotIds,
        })
      ) {
        ledger?.setMetadata(INDEX_CACHE_METADATA_KEY, indexed);
        const edited = reconciled.decisions.filter(
          ({ decision }) => decision.kind !== "self-write" && decision.kind !== "unchanged",
        ).length;
        toast.success(
          `后台索引完成：复用 ${incremental.reusedCount}，更新 ${incremental.changedFiles.length}，发现 ${discovered.length} 个待处理提及${edited ? `，处理 ${edited} 个托管编辑` : ""}`,
        );
      }
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") toast.error(`Vault 索引失败：${String(error)}`);
      setIndexProgress({ phase: "cancelled", current: 0, total: 0 });
    } finally {
      if (scanControllerRef.current === controller) scanControllerRef.current = undefined;
    }
  }

  const cancelScan = () => {
    scanControllerRef.current?.abort();
    setIndexProgress((current) => ({ ...current, phase: "cancelled" }));
    toast.message("已取消后台索引");
  };

  const switchVault = async () => {
    const previousLedger = ledgerRef.current;
    const previousBackend = backendRef.current;
    try {
      await ledgerWriteQueueRef.current.catch(() => undefined);
      const adapter = await pickVault();
      setLedgerError(undefined);
      setLedgerStatus("loading");
      const epoch = ++ledgerEpochRef.current;
      const bytes = await adapter.readBinary(KNOWLEDGE_BRIDGE_LEDGER_PATH);
      const vaultLedger = await GraphLedger.open(
        bytes && bytes.length > 0 ? bytes : undefined,
        (nextBytes) => enqueueLedgerWrite(adapter, nextBytes),
        false,
      );
      if (epoch !== ledgerEpochRef.current) return;

      adapterRef.current = adapter;
      ledgerRef.current = vaultLedger;
      backendRef.current = new LocalKnowledgeBridgeBackend(vaultLedger);
      rememberRecentVault(adapter);
      setVaultName(adapter.name);
      setPersistenceMode("vault");
      const saved = vaultLedger.load();
      setLedgerStatus("ready");
      if (hasSnapshotContent(saved)) {
        const next = appendInitialAnchor(saved, initialAnchor);
        snapshotRef.current = next;
        setSnapshot(next);
        if (next !== saved) backendRef.current.commit({ snapshot: next, kind: "resume-with-anchor" });
        toast.success(`已连接 ${adapter.name}，已载入其中的关系账本`);
      } else {
        backendRef.current.commit({ snapshot: snapshotRef.current, kind: "vault-create" });
        toast.success(`已连接 ${adapter.name}，关系账本将保存到 .knowledge-bridge/graph.db`);
      }
      await startScan(adapter);
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") toast.error(String(error));
      ledgerRef.current = previousLedger;
      backendRef.current = previousBackend;
      setLedgerStatus(previousLedger ? "ready" : "error");
    }
  };

  const resolvePending = async (id: string, action: PendingResolutionAction, candidateId?: string) => {
    const current = snapshotRef.current;
    const item = current.pending.find((entry) => entry.id === id);
    if (!item) return;
    const backend = backendRef.current;
    if (!backend) {
      toast.error("关系账本尚未就绪，请稍后重试。");
      return;
    }
    if (action === "restore-managed-link") {
      if (item.kind !== "severed-link" || !item.relationId) return;
      let prepared: Awaited<ReturnType<typeof prepareManagedLinkWrite>> | undefined;
      try {
        prepared = await prepareManagedLinkWrite(
          adapterRef.current,
          current,
          item.relationId,
          item.filePath,
          item.targetTitle,
        );
        const next = {
          ...prepared.snapshot,
          pending: prepared.snapshot.pending.filter(
            (entry) =>
              entry.id !== item.id &&
              !(
                entry.kind === "wikilink" &&
                entry.filePath === item.filePath &&
                entry.targetTitle === item.targetTitle
              ),
          ),
        };
        const persisted = backend.commit({
          snapshot: next,
          kind: "managed-link-restore",
          sideEffects: {
            upsertLinkSnapshots: [prepared.linkSnapshot],
            fileWrites: [prepared.fileWrite],
          },
        });
        snapshotRef.current = persisted;
        setSnapshot(persisted);
        toast.success(`已恢复托管链接：${item.targetTitle}`);
      } catch (error) {
        if (prepared) await adapterRef.current.write(prepared.fileWrite.path, prepared.fileWrite.before);
        toast.error(`恢复链接失败：${String(error)}`);
      }
      return;
    }
    const newNodeId =
      action === "accept" || action === "lineage-new" ? `pending-node:${crypto.randomUUID()}` : undefined;
    const bindingNodeId = action === "lineage-rebind" ? candidateId : action === "lineage-new" ? newNodeId : undefined;
    let lineageWrite: Awaited<ReturnType<typeof writeLineageBinding>> | undefined;
    try {
      if (item.kind === "lineage" && bindingNodeId) {
        lineageWrite = await writeLineageBinding(adapterRef.current, item, bindingNodeId);
      }
      const applied = backend.applyOperation(
        current,
        createPendingResolutionOperation({
          pendingId: id,
          action,
          candidateId,
          newNodeId,
          sourceMarkdown: lineageWrite ? markdownBody(lineageWrite.after) : undefined,
        }),
        lineageWrite ? { fileWrites: [lineageWrite] } : undefined,
      );
      if (!applied.changed) {
        if (lineageWrite && lineageWrite.after !== lineageWrite.before) {
          await adapterRef.current.write(lineageWrite.path, lineageWrite.before);
        }
        toast.warning("该待定项需要更明确的处理方式。");
        return;
      }
      snapshotRef.current = applied.snapshot;
      setSnapshot(applied.snapshot);
      if (action === "lineage-defer") toast.message(`${item.targetTitle} 已保留在血缘候选栈。`);
      else if (action === "dismiss") toast.success(`已忽略：${item.targetTitle}`);
      else if (action === "lineage-rebind") toast.success(`已重新绑定来源：${item.targetTitle}`);
      else if (action === "lineage-new") toast.success(`已建立新身份：${item.targetTitle}`);
      else toast.success(`已采用为待定认知关系：${item.targetTitle}`);
    } catch (error) {
      if (lineageWrite && lineageWrite.after !== lineageWrite.before) {
        await adapterRef.current.write(lineageWrite.path, lineageWrite.before).catch(() => undefined);
      }
      toast.error(`待定项处理失败：${String(error)}`);
    }
  };

  const freezeBridge = (l2Id: string) => {
    const node = snapshotRef.current.nodes.find((item) => item.id === l2Id);
    if (!node) return;
    if (commitSnapshot(freezeL2(snapshotRef.current, l2Id), "l2-freeze")) {
      toast.message(`${node.title} 已冻结；历史路径保留，等待替代预览。`);
    }
  };

  const adoptBridgeSuggestion = (nodeId: string, suggestion: BridgeSuggestion) => {
    const current = snapshotRef.current;
    const source = current.nodes.find(
      (node) =>
        node.id === nodeId && node.role === "L3" && node.status !== "missing-source" && node.status !== "frozen",
    );
    const bridge = current.nodes.find(
      (node) => node.id === suggestion.bridgeId && node.role === "L2" && node.status === "formal",
    );
    if (!source || (!suggestion.isNewBridge && !bridge)) {
      toast.error("建议引用的知识节点已变化，请重新生成桥梁建议。");
      return;
    }
    const bridgeId = bridge?.id ?? suggestion.bridgeId;
    const bridgeTitle = bridge?.title ?? suggestion.bridgeTitle.trim();
    if (!bridgeTitle) {
      toast.error("AI 没有给出可识别的桥梁机制名称，请重新生成。");
      return;
    }
    const duplicate = current.pending.some(
      (item) =>
        item.kind === "ai-bridge" &&
        item.sourceId === source.id &&
        item.targetTitle.trim().toLocaleLowerCase() === bridgeTitle.toLocaleLowerCase(),
    );
    if (duplicate) {
      toast.message("这条桥梁建议已经在待整理区中。");
      return;
    }
    const now = Date.now();
    const alternatives = suggestion.alternatives.flatMap((alternative, index) => {
      const node = current.nodes.find(
        (candidate) => candidate.id === alternative.id && candidate.role === "L2" && candidate.status === "formal",
      );
      return node
        ? [
            {
              id: node.id,
              title: node.title,
              reason: alternative.reason,
              confidence: Math.max(0, suggestion.confidence - (index + 1) * 0.1),
            },
          ]
        : [];
    });
    const pending: PendingMention = {
      id: `pending:ai-bridge:${crypto.randomUUID()}`,
      filePath: `ai://${suggestion.provider}/bridge/${source.id}`,
      sourceId: source.id,
      targetTitle: bridgeTitle,
      kind: "ai-bridge",
      raw: suggestion.reason,
      suggestedRole: "L2",
      definition: suggestion.bridgeDefinition,
      scope: suggestion.bridgeScope,
      boundary: suggestion.bridgeBoundary,
      anchorId: suggestion.anchorId,
      anchorReason: suggestion.anchorReason,
      anchorEvidence: suggestion.anchorEvidence,
      anchorAlternatives: suggestion.anchorAlternatives,
      candidates: [
        {
          id: bridgeId,
          title: bridgeTitle,
          reason: suggestion.reason,
          confidence: suggestion.confidence,
        },
        ...alternatives,
      ],
    };
    const operation: KnowledgeGraphOperationMeta = {
      id: `kb-operation:${crypto.randomUUID()}`,
      origin: "agent",
      type: "ai-bridge-adopt",
      createdAt: now,
    };
    if (commitSnapshot({ ...current, pending: [...current.pending, pending] }, "ai-bridge-adopt", operation)) {
      setActiveTab("pending");
      toast.success("桥梁建议已进入待整理区，确认前不会参与正式推理。");
    }
  };

  const applyMigration = (preview: ReturnType<typeof buildFrozenL2MigrationPreview>, pathIds: Set<string>) => {
    const next = applyHighConfidenceMigration(snapshotRef.current, preview, pathIds);
    const applied = next.migrationRecords.at(-1)?.pathMappings.length ?? 0;
    if (commitSnapshot(next, "l2-migration")) {
      toast.success(`已迁移 ${applied} 条高置信路径；其余路径继续冻结。`);
    }
  };

  const selectLens = (lensId: string) => {
    const current = snapshotRef.current;
    commitSnapshot(
      { ...current, lenses: current.lenses.map((lens) => ({ ...lens, active: lens.id === lensId })) },
      "lens-select",
    );
  };

  const savePaperDraft = (draft: PaperBridgeDraft) => {
    const current = snapshotRef.current;
    const paperDrafts = current.paperDrafts.some((item) => item.id === draft.id)
      ? current.paperDrafts.map((item) => (item.id === draft.id ? draft : item))
      : [...current.paperDrafts, draft];
    if (commitSnapshot({ ...current, paperDrafts }, "paper-bridge-draft")) {
      toast.success("AI 学习链已保存为草稿，尚未进入正式推理。");
    }
  };

  const adoptPaperDraft = (draft: PaperBridgeDraft) => {
    const current = snapshotRef.current;
    const backend = backendRef.current;
    if (!backend) {
      toast.error("关系账本尚未就绪，请稍后重试。");
      return false;
    }
    const applied = backend.applyOperation(current, createAgentProposalOperation(draft));
    if (!applied.changed) return false;
    snapshotRef.current = applied.snapshot;
    setSnapshot(applied.snapshot);
    const proposal = applied.snapshot.graphProposals.at(-1);
    const nodeCount = proposal?.operations.filter((operation) => operation.type === "create-node").length ?? 0;
    const relationCount = proposal?.operations.filter((operation) => operation.type === "create-relation").length ?? 0;
    toast.success(`已应用到画布：${nodeCount} 个待定节点，${relationCount} 条认知关系。`);
    return true;
  };

  const saveConnection = (settings: AiConnectionSettings) => {
    const next = saveAiConnection(settings);
    setAiConnection(next);
    toast.success(next.endpoint ? "AI 连接已保存。" : "AI 已切换为本地草拟模式。");
  };

  const addAnchor = () => {
    const title = anchorInput.trim();
    if (!title) return;
    const current = snapshotRef.current;
    const next = appendInitialAnchor(current, title);
    if (next === current) {
      toast.message("该旧知锚点已在当前账本中。");
      return;
    }
    if (!commitSnapshot(next, "anchor-confirm")) return;
    setAnchorInput("");
    toast.success(`已确认旧知锚点：${title}`);
  };

  const undoLastChange = async () => {
    const backend = backendRef.current;
    if (!backend) {
      toast.error("关系账本尚未就绪，请稍后重试。");
      return;
    }
    try {
      const restored = backend.undoWithSideEffects();
      if (!restored) {
        toast.message("没有可撤销的账本变更。");
        return;
      }
      await Promise.all(restored.fileRestores.map((file) => adapterRef.current.write(file.path, file.content)));
      snapshotRef.current = restored.snapshot;
      setSnapshot(restored.snapshot);
      toast.success("已撤销上次账本变更，画布已同步还原。");
    } catch (error) {
      toast.error(`撤销失败：${String(error)}`);
    }
  };

  return (
    <div className="bg-background text-foreground flex h-full min-h-0 flex-col">
      <HoverPreviewLayer preview={hoverPreview} snapshot={snapshot} />
      <div className="border-b px-3 py-3">
        <div className="flex items-center gap-2">
          <Database className="size-4" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{vaultName} · Vault</div>
            <div className="text-muted-foreground mt-0.5 text-[11px]">
              {vaultBacked ? ".knowledge-bridge/graph.db" : "本机持久账本（自动恢复；连接 Vault 后写入 graph.db）"}
            </div>
          </div>
          <Badge variant={ledgerStatus === "error" ? "destructive" : ledgerBusy || scanning ? "secondary" : "outline"}>
            {ledgerBusy || scanning ? (
              <LoaderCircle className="animate-spin" />
            ) : ledgerStatus === "error" ? (
              <CircleAlert />
            ) : (
              <ShieldCheck />
            )}
            {ledgerStatusLabel}
          </Badge>
        </div>
        <Progress value={ledgerBusy ? undefined : progressValue} className="mt-3 h-1" />
        {ledgerStatus === "error" ? (
          <div className="border-destructive/40 bg-destructive/10 text-destructive mt-3 flex items-center gap-2 border px-2 py-2 text-xs">
            <CircleAlert className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate" title={ledgerError}>
              账本不可用，修改已暂停。{ledgerError ? ` ${ledgerError}` : ""}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0"
              onClick={() => setLedgerAttempt((value) => value + 1)}
            >
              重试
            </Button>
          </div>
        ) : null}
        <div className="mt-3 flex border-y py-2">
          <Metric label="正式节点" value={snapshot.nodes.filter((item) => item.status === "formal").length} />
          <Metric label="逻辑关系" value={snapshot.relations.filter((item) => item.layer === "logical").length} />
          <Metric label="待整理" value={snapshot.pending.length} />
        </div>
        <div className="mt-3 flex gap-2">
          <Input
            value={anchorInput}
            onChange={(event) => setAnchorInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addAnchor();
            }}
            placeholder="输入你已经理解的概念，作为本次桥接的旧知锚点"
            className="h-8 text-xs"
            disabled={mutationDisabled}
          />
          <Button
            size="sm"
            className="h-8 shrink-0"
            onClick={addAnchor}
            disabled={mutationDisabled || !anchorInput.trim()}
          >
            确认旧知
          </Button>
        </div>
      </div>

      <fieldset disabled={mutationDisabled} className="flex min-h-0 flex-1 flex-col border-0 p-0">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0 flex-1 gap-0">
          <TabsList variant="line" className="mx-3 mt-1 w-[calc(100%-1.5rem)] justify-start">
            <TabsTrigger value="paper">材料桥接</TabsTrigger>
            <TabsTrigger value="pending">待整理</TabsTrigger>
            <TabsTrigger value="bridge">AI 桥梁</TabsTrigger>
            <TabsTrigger value="evidence">证据与尺度</TabsTrigger>
          </TabsList>
          <TabsContent value="paper" className="min-h-0 overflow-y-auto p-3">
            <PaperBridgePanel
              snapshot={snapshot}
              backend={backendRef.current}
              connection={aiConnection}
              initialInput={initialInput}
              onSaveDraft={savePaperDraft}
              onAdoptDraft={adoptPaperDraft}
              onConfigure={() => setActiveTab("ai")}
              projectUri={activeProject?.uri.toString()}
            />
          </TabsContent>
          <TabsContent value="pending" className="min-h-0 overflow-y-auto p-3">
            <PendingPool items={snapshot.pending} onResolve={resolvePending} />
          </TabsContent>
          <TabsContent value="bridge" className="min-h-0 overflow-y-auto p-3">
            <BridgeSuggestions
              snapshot={snapshot}
              connection={aiConnection}
              onFreeze={freezeBridge}
              onAdoptSuggestion={adoptBridgeSuggestion}
              onApplyMigration={applyMigration}
            />
          </TabsContent>
          <TabsContent value="evidence" className="min-h-0 overflow-y-auto p-3">
            <EvidencePanel snapshot={snapshot} onSelectLens={selectLens} />
          </TabsContent>
          <TabsContent value="ai" className="min-h-0 overflow-y-auto p-3">
            <AiSettingsPanel value={aiConnection} onSave={saveConnection} />
          </TabsContent>
        </Tabs>

        <div className="flex items-center gap-2 border-t p-2">
          <Button className="flex-1" size="sm" onClick={scanning ? cancelScan : () => void startScan()}>
            {scanning ? <X /> : <RefreshCw />}
            {scanning ? "取消扫描" : "后台索引"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void switchVault()} disabled={scanning}>
            {vaultBacked ? "更换 Vault" : "连接 Vault"}
          </Button>
          <Button size="icon" variant="ghost" title="撤销上次账本变更" onClick={() => void undoLastChange()}>
            <Undo2 />
          </Button>
          <Button size="icon" variant="ghost" title="AI 设置" onClick={() => setActiveTab("ai")}>
            <SlidersHorizontal />
          </Button>
        </div>
      </fieldset>
    </div>
  );
}

KnowledgeBridgeWindow.open = async (options: KnowledgeBridgeLaunchOptions = {}) => {
  const [{ createSubWindow }, { Vector }, { Rectangle }] = await Promise.all([
    import("@/core/subWindowOpen"),
    import("@graphif/data-structures"),
    import("@graphif/shapes"),
  ]);
  createSubWindow("KnowledgeBridgeWindow", {
    title: "Knowledge Bridge",
    contextTarget: "activeResourceTab",
    children: <KnowledgeBridgeWindow {...options} />,
    rect: Rectangle.inCenter(new Vector(Math.min(1120, innerWidth * 0.92), Math.min(780, innerHeight * 0.9))),
    canDock: false,
    closeWhenClickOutside: false,
  });
};
