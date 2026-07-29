import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { Project } from "@/core/Project";
import { runApprovedKnowledgeBridgeTools, runKnowledgeBridgeAgent } from "@/knowledge-bridge/agentRuntime";
import { loadAiConnection, saveAiConnection, type AiConnectionSettings } from "@/knowledge-bridge/aiSettings";
import { applyGraphChangeProposal, createGraphChangeProposal } from "@/knowledge-bridge/graphProposal";
import { collectVaultFiles, indexMarkdown, toPending } from "@/knowledge-bridge/indexer";
import { GraphLedger } from "@/knowledge-bridge/ledger";
import { rejectPendingMcpRequests } from "@/knowledge-bridge/mcpOrchestrator";
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
  type McpToolRequestStatus,
  type PaperBridgeDraft,
  type PendingMention,
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
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { activeResourceTabAtom } from "@/state";

const kindLabels: Record<PendingMention["kind"], string> = {
  wikilink: "双链提及",
  orphan: "孤立来源",
  lineage: "血缘候选",
  "ai-bridge": "AI 桥梁",
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
  connection,
  initialInput,
  onSaveDraft,
  onAdoptDraft,
  onConfigure,
  projectUri,
}: {
  snapshot: VaultSnapshot;
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
    setGenerating(true);
    try {
      setDraft(
        await runKnowledgeBridgeAgent({
          input,
          snapshot,
          connection,
          projectUri,
        }),
      );
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
    setRunningMcp(true);
    try {
      const next = await runApprovedKnowledgeBridgeTools({
        draft: displayedDraft,
        approvedRequestIds: [...approvedMcpRequestIds],
        snapshot,
        connection,
        projectUri,
      });
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

function PendingRow({ item, onResolve }: { item: PendingMention; onResolve: (id: string, accepted: boolean) => void }) {
  const Icon = item.kind === "lineage" ? FileQuestion : item.kind === "ai-bridge" ? Sparkles : Link2;
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
        <div className="flex shrink-0 gap-1">
          <Button size="icon" variant="ghost" className="size-7" title="确认" onClick={() => onResolve(item.id, true)}>
            <Check className="size-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="size-7" title="忽略" onClick={() => onResolve(item.id, false)}>
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function PendingPool({
  items,
  onResolve,
}: {
  items: PendingMention[];
  onResolve: (id: string, accepted: boolean) => void;
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
  onFreeze,
  onApplyMigration,
}: {
  snapshot: VaultSnapshot;
  onFreeze: (l2Id: string) => void;
  onApplyMigration: (preview: ReturnType<typeof buildFrozenL2MigrationPreview>) => void;
}) {
  const anchor = snapshot.nodes.find((node) => node.role === "L1" && node.sourceKind !== "denied");
  const l2Nodes = snapshot.nodes.filter((node) => node.role === "L2");
  const frozenL2 = l2Nodes.find((node) => node.status === "frozen");
  const preview = useMemo(
    () => (frozenL2 ? buildFrozenL2MigrationPreview(snapshot, frozenL2.id, 0) : undefined),
    [frozenL2?.id, snapshot],
  );
  const highConfidenceCount =
    preview?.paths.filter((entry) => {
      const best = entry.candidates[0];
      return best && best.confidence >= 0.8 && !best.conflict;
    }).length ?? 0;

  return (
    <div className="space-y-3">
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
              <div className="text-muted-foreground">仅预选 {highConfidenceCount} 条高置信、无冲突路径。</div>
            </div>
            {preview.paths.slice(0, 3).map((entry) => {
              const best = entry.candidates[0];
              return (
                <div key={entry.path.id} className="flex items-center gap-2 border-b px-3 py-2.5 last:border-b-0">
                  <span className="text-muted-foreground w-4 text-xs">
                    {entry.path.family === "未设条件" ? "-" : "~"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {best ? snapshot.nodes.find((node) => node.id === best.l2Id)?.title : "无可靠替代"}
                  </span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {best ? `${Math.round(best.confidence * 100)}%` : "冻结"}
                  </span>
                </div>
              );
            })}
            <div className="p-2">
              <Button
                size="sm"
                className="w-full"
                disabled={highConfidenceCount === 0}
                onClick={() => onApplyMigration(preview)}
              >
                应用高置信替代
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
  const tension = snapshot.relations.find((relation) => relation.evidence?.length);
  const readings = tension?.evidence ?? [];
  const protocol = snapshot.protocols[0];
  const bundledRelations = relationBundles(snapshot);
  const secondaryCount = bundledRelations.reduce((count, bundle) => count + bundle.secondary.length, 0);
  const cognitiveSecondaryCount = bundledRelations.reduce(
    (count, bundle) => count + bundle.secondary.filter((relation) => relation.layer === "cognitive").length,
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
          <Badge variant="outline">{tension ? "多视角" : "暂无评价"}</Badge>
        </div>
        <div className="space-y-3 p-3">
          <div className="h-0.5 w-full bg-[linear-gradient(90deg,#3b82f6_0_45%,transparent_45%_55%,#ef4444_55%_100%)]" />
          <div className="grid grid-cols-2 gap-2 text-xs">
            {readings.slice(0, 2).map((reading) => (
              <div
                key={`${reading.perspective}:${reading.direction}`}
                className={reading.direction === "challenges" ? "text-right" : ""}
              >
                <div
                  className={
                    reading.direction === "challenges" ? "font-medium text-red-400" : "font-medium text-blue-400"
                  }
                >
                  {reading.level} {reading.direction === "challenges" ? "反驳" : "支持"}
                </div>
                <div className="text-muted-foreground mt-1">{reading.perspective}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border">
        <div className="bg-muted/35 flex items-center gap-2 border-b px-3 py-2 text-xs font-medium">
          <Scale className="size-3.5" />
          尺度换算协议
        </div>
        <div className="p-3">
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="outline">分子</Badge>
            <span className="text-muted-foreground">→</span>
            <Badge variant="outline">个体</Badge>
            <Badge className="ml-auto" variant="secondary">
              {protocol?.status === "confirmed" ? "已引用" : "尺度鸿沟"}
            </Badge>
          </div>
          <div className="text-muted-foreground mt-3 text-xs leading-6">
            {protocol?.mechanismSteps.join(" → ") ?? "需要补充中间机制"}
          </div>
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
            {secondaryCount} 条次级关系，含 {cognitiveSecondaryCount} 条认知脚手架
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
  const snapshotRef = useRef(snapshot);
  const ledgerRef = useRef<GraphLedger | undefined>(undefined);
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

  const commitSnapshot = (next: VaultSnapshot, kind: string): boolean => {
    const ledger = ledgerRef.current;
    if (!ledger) {
      toast.error("关系账本尚未就绪，请稍后重试。");
      return false;
    }
    try {
      ledger.save(next, kind);
      snapshotRef.current = next;
      setSnapshot(next);
      return true;
    } catch (error) {
      const message = String(error);
      setLedgerError(message);
      setLedgerStatus("error");
      toast.error(`无法保存关系账本：${message}`);
      return false;
    }
  };

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
          if (next !== saved) ledger.save(next, hasSnapshotContent(saved) ? "resume-with-anchor" : "vault-create");
          toast.message(`已恢复 ${recentVault.name}，新材料会基于已有锚点继续桥接。`);
          return;
        } catch (error) {
          recentVaultError = error;
        }
      }

      const ledger = await GraphLedger.open();
      if (disposed || epoch !== ledgerEpochRef.current) return;
      ledgerRef.current = ledger;
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
        ledger.save(
          next,
          hasSnapshotContent(saved) ? "resume-with-anchor" : freshStart ? "welcome-start" : "initial-empty",
        );
      }
      if (recentVaultError) {
        toast.warning(`最近的 Vault 无法恢复，已切换到本地持久账本：${String(recentVaultError)}`);
      }
    })().catch((error: unknown) => {
      if (disposed || epoch !== ledgerEpochRef.current) return;
      const message = String(error);
      ledgerRef.current = undefined;
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

  const startScan = async (adapter = adapterRef.current) => {
    scanControllerRef.current?.abort();
    const controller = new AbortController();
    scanControllerRef.current = controller;
    setIndexProgress({ phase: "scanning", current: 0, total: 0 });
    try {
      const files = await collectVaultFiles(adapter, controller.signal, setIndexProgress);
      if (controller.signal.aborted) {
        setIndexProgress({ phase: "cancelled", current: files.length, total: files.length });
        return;
      }
      const indexed = await indexMarkdown(files, controller.signal, setIndexProgress);
      if (controller.signal.aborted) return;
      const current = snapshotRef.current;
      const discovered = toPending(indexed, new Set(current.nodes.map((node) => node.id)));
      const merged = new Map(current.pending.map((item) => [item.id, item]));
      for (const item of discovered) merged.set(item.id, item);
      if (commitSnapshot({ ...current, pending: [...merged.values()] }, "vault-index")) {
        toast.success(`后台索引完成，发现 ${discovered.length} 个待处理提及`);
      }
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") toast.error(`Vault 索引失败：${String(error)}`);
      setIndexProgress({ phase: "cancelled", current: 0, total: 0 });
    } finally {
      if (scanControllerRef.current === controller) scanControllerRef.current = undefined;
    }
  };

  const cancelScan = () => {
    scanControllerRef.current?.abort();
    setIndexProgress((current) => ({ ...current, phase: "cancelled" }));
    toast.message("已取消后台索引");
  };

  const switchVault = async () => {
    const previousLedger = ledgerRef.current;
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
      rememberRecentVault(adapter);
      setVaultName(adapter.name);
      setPersistenceMode("vault");
      const saved = vaultLedger.load();
      setLedgerStatus("ready");
      if (hasSnapshotContent(saved)) {
        const next = appendInitialAnchor(saved, initialAnchor);
        snapshotRef.current = next;
        setSnapshot(next);
        if (next !== saved) vaultLedger.save(next, "resume-with-anchor");
        toast.success(`已连接 ${adapter.name}，已载入其中的关系账本`);
      } else {
        vaultLedger.save(snapshotRef.current, "vault-create");
        toast.success(`已连接 ${adapter.name}，关系账本将保存到 .knowledge-bridge/graph.db`);
      }
      await startScan(adapter);
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") toast.error(String(error));
      setLedgerStatus(previousLedger ? "ready" : "error");
    }
  };

  const resolvePending = (id: string, accepted: boolean) => {
    const current = snapshotRef.current;
    const item = current.pending.find((entry) => entry.id === id);
    if (!item) return;
    if (
      commitSnapshot(
        { ...current, pending: current.pending.filter((entry) => entry.id !== id) },
        accepted ? "pending-confirm" : "pending-dismiss",
      )
    ) {
      toast.success(accepted ? `已确认：${item.targetTitle}` : `已忽略：${item.targetTitle}`);
    }
  };

  const freezeBridge = (l2Id: string) => {
    const node = snapshotRef.current.nodes.find((item) => item.id === l2Id);
    if (!node) return;
    if (commitSnapshot(freezeL2(snapshotRef.current, l2Id), "l2-freeze")) {
      toast.message(`${node.title} 已冻结；历史路径保留，等待替代预览。`);
    }
  };

  const applyMigration = (preview: ReturnType<typeof buildFrozenL2MigrationPreview>) => {
    const next = applyHighConfidenceMigration(snapshotRef.current, preview);
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
    const adoptedDraft = { ...draft, status: "adopted" as const };
    const paperDrafts = current.paperDrafts.some((item) => item.id === draft.id)
      ? current.paperDrafts.map((item) => (item.id === draft.id ? adoptedDraft : item))
      : [...current.paperDrafts, adoptedDraft];
    const proposal = createGraphChangeProposal(draft, current);
    const staged = {
      ...current,
      paperDrafts,
      graphProposals: [...current.graphProposals, proposal],
    };
    const committed = commitSnapshot(applyGraphChangeProposal(staged, proposal.id), "agent-graph-proposal-apply");
    if (!committed) return false;
    const nodeCount = proposal.operations.filter((operation) => operation.type === "create-node").length;
    const relationCount = proposal.operations.filter((operation) => operation.type === "create-relation").length;
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

  const undoLastChange = () => {
    const ledger = ledgerRef.current;
    if (!ledger) {
      toast.error("关系账本尚未就绪，请稍后重试。");
      return;
    }
    try {
      const restored = ledger.undo();
      if (!restored) {
        toast.message("没有可撤销的账本变更。");
        return;
      }
      snapshotRef.current = restored;
      setSnapshot(restored);
      toast.success("已撤销上次账本变更，画布已同步还原。");
    } catch (error) {
      toast.error(`撤销失败：${String(error)}`);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
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
            <BridgeSuggestions snapshot={snapshot} onFreeze={freezeBridge} onApplyMigration={applyMigration} />
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
          <Button size="icon" variant="ghost" title="撤销上次账本变更" onClick={undoLastChange}>
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
