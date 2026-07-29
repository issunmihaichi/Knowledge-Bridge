import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createSubWindow } from "@/core/subWindowOpen";
import { TabWorkspace } from "@/core/TabWorkspace";
import { store, tabsAtom } from "@/state";
import KnowledgeBridgeWindow from "@/sub/KnowledgeBridgeWindow";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { ArrowRight, Network, Sparkles } from "lucide-react";
import { useState } from "react";

const welcomeTabIds = new Set<string>();
const domains = ["跨学科", "生物", "物理", "化学", "数学", "历史", "社会科学", "语言与文学", "计算机"];

function isKnowledgeBridgeWelcome(tab: { id: string }): boolean {
  return welcomeTabIds.has(tab.id);
}

function KnowledgeBridgeWelcomeWindow({ tabId }: { tabId: string }) {
  const [domain, setDomain] = useState("跨学科");
  const [anchor, setAnchor] = useState("");
  const [material, setMaterial] = useState("");

  const openWorkspace = async (blank = false) => {
    KnowledgeBridgeWindow.open({
      initialVaultName: domain === "跨学科" ? "跨学科知识库" : `${domain}知识库`,
      initialAnchor: blank ? undefined : anchor,
      initialInput: blank ? "" : material,
      freshStart: true,
    });
    await TabWorkspace.close(tabId);
    welcomeTabIds.delete(tabId);
  };

  return (
    <div className="bg-background text-foreground flex h-full w-full overflow-auto p-5 sm:p-8">
      <main className="m-auto w-full max-w-2xl">
        <header className="border-b pb-6">
          <div className="flex items-center gap-2">
            <Network className="size-5" />
            <span className="text-sm font-medium">Knowledge Bridge</span>
            <Badge variant="outline">全学科</Badge>
          </div>
          <h1 className="mt-4 text-2xl font-semibold">把新材料接回你已经理解的知识</h1>
          <p className="text-muted-foreground mt-2 max-w-xl text-sm leading-6">
            从论文、教材、笔记或一个问题开始。系统会草拟概念、桥梁机制和学习锚点，仍由你决定哪些路径被采用。
          </p>
        </header>

        <section className="border-b py-6" aria-labelledby="domain-heading">
          <div className="flex items-center justify-between gap-3">
            <h2 id="domain-heading" className="text-sm font-medium">
              起始领域
            </h2>
            <span className="text-muted-foreground text-xs">可随时跨领域</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {domains.map((item) => (
              <Button
                key={item}
                size="sm"
                variant={domain === item ? "secondary" : "outline"}
                className="h-8 px-3 text-xs"
                onClick={() => setDomain(item)}
              >
                {item}
              </Button>
            ))}
          </div>
        </section>

        <section className="space-y-5 py-6" aria-label="开始材料桥接">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="knowledge-anchor">
              我已经理解的概念
            </label>
            <Input
              id="knowledge-anchor"
              value={anchor}
              onChange={(event) => setAnchor(event.target.value)}
              placeholder="例如：函数、细胞膜、供需关系、论证结构"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="source-material">
              想理解的新材料
            </label>
            <Textarea
              id="source-material"
              value={material}
              onChange={(event) => setMaterial(event.target.value)}
              className="min-h-36 resize-y text-sm"
              placeholder="粘贴论文摘要、教材段落、笔记、题目或问题"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={!anchor.trim() && !material.trim()} onClick={() => void openWorkspace()}>
              <Sparkles />
              开始材料桥接
              <ArrowRight />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void openWorkspace(true)}>
              进入空白工作区
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}

KnowledgeBridgeWelcomeWindow.open = () => {
  const existing = store.get(tabsAtom).find((tab) => !tab.closing && isKnowledgeBridgeWelcome(tab));
  if (existing) {
    TabWorkspace.focus(existing.id);
    return existing;
  }

  const tab = createSubWindow("KnowledgeBridgeWelcomeWindow", {
    title: "Knowledge Bridge",
    contextTarget: "activeResourceTab",
    children: (componentTab) => <KnowledgeBridgeWelcomeWindow tabId={componentTab.id} />,
    rect: Rectangle.inCenter(new Vector(Math.min(760, innerWidth * 0.88), Math.min(670, innerHeight * 0.84))),
    canDock: false,
    titleBarOverlay: true,
    closeWhenClickOutside: true,
  });
  welcomeTabIds.add(tab.id);
  return tab;
};

export default KnowledgeBridgeWelcomeWindow;
