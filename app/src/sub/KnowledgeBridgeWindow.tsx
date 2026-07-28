import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createSubWindow } from "@/core/subWindowOpen";
import { collectVaultFiles, indexMarkdown, toPending } from "@/knowledge-bridge/indexer";
import { GraphLedger } from "@/knowledge-bridge/ledger";
import {
  demoVaultSnapshot,
  type IndexProgress,
  type PendingMention,
  type VaultSnapshot,
} from "@/knowledge-bridge/model";
import { DemoVaultAdapter, pickVault, type VaultAdapter } from "@/knowledge-bridge/vault";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
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
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const kindLabels: Record<PendingMention["kind"], string> = {
  wikilink: "双链提及",
  orphan: "孤立来源",
  lineage: "血缘候选",
  "ai-bridge": "AI 桥梁",
};

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 flex-1 border-r px-3 last:border-r-0">
      <div className="text-muted-foreground text-[11px]">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
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

function BridgeSuggestions() {
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-md border">
        <div className="bg-muted/35 flex items-center gap-2 border-b px-3 py-2 text-xs font-medium">
          <Bot className="size-3.5" />
          锚点选择依据
        </div>
        <div className="space-y-2 p-3 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">L1 细胞与遗传</span>
            <Badge>87%</Badge>
          </div>
          <div className="text-muted-foreground leading-5">来自已确认课程笔记、近期访问和 4 条手工连接。</div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline">备选：进化</Badge>
            <Badge variant="outline">备选：稳态</Badge>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border">
        <div className="bg-muted/35 flex items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-medium">
            <GitBranch className="size-3.5" />
            L2 替代候选
          </div>
          <Badge variant="secondary">Top 3</Badge>
        </div>
        {["信息流与调控", "反馈调节", "选择压力"].map((title, index) => (
          <div key={title} className="flex items-center gap-2 border-b px-3 py-2.5 last:border-b-0">
            <span className="text-muted-foreground w-4 text-xs tabular-nums">{index + 1}</span>
            <span className="min-w-0 flex-1 text-sm">{title}</span>
            <span className="text-muted-foreground text-xs tabular-nums">{[92, 78, 71][index]}%</span>
            {index === 0 && (
              <Button size="sm" className="h-7 px-2 text-xs" onClick={() => toast.success("已加入批量迁移预览")}>
                应用
              </Button>
            )}
          </div>
        ))}
      </div>

      <div className="border-muted-foreground/30 flex items-center gap-2 rounded-md border border-dashed px-3 py-2.5">
        <ArchiveRestore className="text-muted-foreground size-4" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium">冻结路径</div>
          <div className="text-muted-foreground text-[11px]">历史 L2 · 12 条路径等待替换预览</div>
        </div>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs">
          查看
        </Button>
      </div>
    </div>
  );
}

function EvidencePanel() {
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-md border">
        <div className="bg-muted/35 flex items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-medium">
            <ShieldCheck className="size-3.5" />
            证据张力线
          </div>
          <Badge variant="outline">L4a → L4b</Badge>
        </div>
        <div className="space-y-3 p-3">
          <div className="h-0.5 w-full bg-[linear-gradient(90deg,#3b82f6_0_45%,transparent_45%_55%,#ef4444_55%_100%)]" />
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="font-medium text-blue-400">E3 支持</div>
              <div className="text-muted-foreground mt-1">克隆演化视角</div>
            </div>
            <div className="text-right">
              <div className="font-medium text-red-400">E2 反驳</div>
              <div className="text-muted-foreground mt-1">微环境主导视角</div>
            </div>
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
              已引用
            </Badge>
          </div>
          <div className="text-muted-foreground mt-3 text-xs leading-6">编辑效率 → 克隆扩增 → 组织表型 → 临床终点</div>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-md border px-3 py-2.5">
        <CircleAlert className="size-4 text-amber-400" />
        <div className="min-w-0 flex-1 text-xs">
          <span className="font-medium">认知层默认隐藏</span>
          <span className="text-muted-foreground ml-2">1 条脚手架</span>
        </div>
      </div>
    </div>
  );
}

export default function KnowledgeBridgeWindow() {
  const [snapshot, setSnapshot] = useState<VaultSnapshot>(demoVaultSnapshot);
  const [vaultName, setVaultName] = useState("生物学知识库");
  const [indexProgress, setIndexProgress] = useState<IndexProgress>({ phase: "idle", current: 0, total: 0 });
  const snapshotRef = useRef(snapshot);
  const ledgerRef = useRef<GraphLedger | undefined>(undefined);
  const adapterRef = useRef<VaultAdapter>(new DemoVaultAdapter());
  const scanControllerRef = useRef<AbortController | undefined>(undefined);
  const scanning = indexProgress.phase === "scanning";
  const progressValue =
    scanning && indexProgress.total === 0
      ? undefined
      : indexProgress.total > 0
        ? Math.round((indexProgress.current / indexProgress.total) * 100)
        : 100;

  const commitSnapshot = (next: VaultSnapshot, kind: string) => {
    snapshotRef.current = next;
    setSnapshot(next);
    ledgerRef.current?.save(next, kind);
  };

  useEffect(() => {
    let disposed = false;
    void GraphLedger.open()
      .then((ledger) => {
        if (disposed) return;
        ledgerRef.current = ledger;
        const saved = ledger.load();
        if (saved.nodes.length > 0) {
          snapshotRef.current = saved;
          setSnapshot(saved);
        } else {
          ledger.save(demoVaultSnapshot, "initial-demo");
        }
      })
      .catch((error: unknown) => toast.error(`关系账本打开失败：${String(error)}`));
    return () => {
      disposed = true;
      scanControllerRef.current?.abort();
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
      commitSnapshot({ ...current, pending: [...merged.values()] }, "vault-index");
      toast.success(`后台索引完成，发现 ${discovered.length} 个待处理提及`);
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
    try {
      const adapter = await pickVault();
      adapterRef.current = adapter;
      setVaultName(adapter.name);
      toast.success(`已切换到 ${adapter.name}`);
      await startScan(adapter);
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") toast.error(String(error));
    }
  };

  const resolvePending = (id: string, accepted: boolean) => {
    const current = snapshotRef.current;
    const item = current.pending.find((entry) => entry.id === id);
    if (!item) return;
    commitSnapshot(
      { ...current, pending: current.pending.filter((entry) => entry.id !== id) },
      accepted ? "pending-confirm" : "pending-dismiss",
    );
    toast.success(accepted ? `已确认：${item.targetTitle}` : `已忽略：${item.targetTitle}`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-3 py-3">
        <div className="flex items-center gap-2">
          <Database className="size-4" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{vaultName} · Vault</div>
            <div className="text-muted-foreground mt-0.5 text-[11px]">.knowledge-bridge/graph.db</div>
          </div>
          <Badge variant={scanning ? "secondary" : "outline"}>
            {scanning ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}
            {scanning ? "索引中" : "已同步"}
          </Badge>
        </div>
        <Progress value={progressValue} className="mt-3 h-1" />
        <div className="mt-3 flex border-y py-2">
          <Metric label="正式节点" value={snapshot.nodes.filter((item) => item.status === "formal").length} />
          <Metric label="逻辑关系" value={snapshot.relations.filter((item) => item.layer === "logical").length} />
          <Metric label="待整理" value={snapshot.pending.length} />
        </div>
      </div>

      <Tabs defaultValue="pending" className="min-h-0 flex-1 gap-0">
        <TabsList variant="line" className="mx-3 mt-1 w-[calc(100%-1.5rem)] justify-start">
          <TabsTrigger value="pending">待整理</TabsTrigger>
          <TabsTrigger value="bridge">AI 桥梁</TabsTrigger>
          <TabsTrigger value="evidence">证据与尺度</TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="min-h-0 overflow-y-auto p-3">
          <PendingPool items={snapshot.pending} onResolve={resolvePending} />
        </TabsContent>
        <TabsContent value="bridge" className="min-h-0 overflow-y-auto p-3">
          <BridgeSuggestions />
        </TabsContent>
        <TabsContent value="evidence" className="min-h-0 overflow-y-auto p-3">
          <EvidencePanel />
        </TabsContent>
      </Tabs>

      <div className="flex items-center gap-2 border-t p-2">
        <Button className="flex-1" size="sm" onClick={scanning ? cancelScan : () => void startScan()}>
          {scanning ? <X /> : <RefreshCw />}
          {scanning ? "取消扫描" : "后台索引"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void switchVault()} disabled={scanning}>
          切换 Vault
        </Button>
      </div>
    </div>
  );
}

KnowledgeBridgeWindow.open = () => {
  createSubWindow("KnowledgeBridgeWindow", {
    title: "Knowledge Bridge",
    contextTarget: "activeResourceTab",
    children: <KnowledgeBridgeWindow />,
    rect: new Rectangle(new Vector(1020, 52), new Vector(390, 790)),
  });
};
