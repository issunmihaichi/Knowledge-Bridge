import { AIMCPStore, materializeMCPServers, prepareMCPTools } from "../core/service/dataManageService/aiEngine/AIMCP";
import { discoverSkills, type AISkill } from "../core/service/dataManageService/aiEngine/AISkills";
import type { AiConnectionSettings } from "./aiSettings";
import { draftPaperBridge, type PaperBridgeAgentSupport } from "./paperBridgeAi";
import type { AgentExecutionTrace, PaperBridgeDraft, VaultSnapshot } from "./model";
import { executeApprovedMcpRequests } from "./mcpOrchestrator";

export interface KnowledgeBridgeAgentRequest {
  input: string;
  snapshot: VaultSnapshot;
  connection: AiConnectionSettings;
  projectUri?: string;
  now?: number;
}

export interface ApprovedMcpAgentRequest {
  draft: PaperBridgeDraft;
  approvedRequestIds: string[];
  snapshot: VaultSnapshot;
  connection: AiConnectionSettings;
  projectUri?: string;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function terms(value: string): string[] {
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
}

function selectSkills(input: string, catalog: Map<string, AISkill>): AISkill[] {
  const inputTerms = new Set(terms(input));
  return [...catalog.values()]
    .map((skill) => {
      const searchable = `${skill.name} ${skill.description}`.toLocaleLowerCase();
      const score = [...inputTerms].filter((term) => searchable.includes(term)).length;
      return { skill, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.skill.name.localeCompare(right.skill.name))
    .slice(0, 2)
    .map((entry) => entry.skill);
}

async function loadAgentSupport(
  input: string,
  projectUri: string | undefined,
): Promise<{
  support: PaperBridgeAgentSupport;
  servers: string[];
  availableSkills: string[];
  activatedSkills: string[];
  warnings: string[];
}> {
  const empty = {
    support: { skills: [], mcpTools: [] },
    servers: [],
    availableSkills: [],
    activatedSkills: [],
    warnings: [] as string[],
  };
  if (!isTauriRuntime()) return empty;

  const warnings: string[] = [];
  let catalog = new Map<string, AISkill>();
  try {
    catalog = await discoverSkills(projectUri ?? "draft:/knowledge-bridge");
  } catch (error) {
    warnings.push(`Skill discovery failed: ${String(error)}`);
  }
  const selectedSkills = selectSkills(input, catalog);

  let servers: string[] = [];
  let mcpTools: PaperBridgeAgentSupport["mcpTools"] = [];
  try {
    const configs = materializeMCPServers(await AIMCPStore.load()).filter((server) => server.enabled);
    servers = configs.map((server) => server.name);
    mcpTools = configs.flatMap((server) => {
      const enabled = new Set(server.enabledTools);
      return server.cachedTools
        .filter((descriptor) => enabled.has(descriptor.name))
        .map((descriptor) => ({
          server: server.name,
          name: descriptor.name,
          modelName: descriptor.modelName,
          description: descriptor.description,
          inputSchema: descriptor.inputSchema,
        }));
    });
  } catch (error) {
    warnings.push(`MCP catalog loading failed: ${String(error)}`);
  }

  return {
    support: {
      skills: selectedSkills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        instructions: skill.body,
      })),
      mcpTools,
    },
    servers,
    availableSkills: [...catalog.keys()].sort(),
    activatedSkills: selectedSkills.map((skill) => skill.name),
    warnings,
  };
}

export async function runKnowledgeBridgeAgent(request: KnowledgeBridgeAgentRequest): Promise<PaperBridgeDraft> {
  const startedAt = request.now ?? Date.now();
  const capabilities = await loadAgentSupport(request.input, request.projectUri);
  const { plannedMcpRequests = [], ...draft } = await draftPaperBridge(
    request.input,
    request.snapshot,
    startedAt,
    request.connection,
    capabilities.support,
  );
  const trace: AgentExecutionTrace = {
    id: `agent-trace:${crypto.randomUUID()}`,
    startedAt,
    completedAt: Date.now(),
    llm: {
      provider: draft.provider,
      model: request.connection.endpoint ? request.connection.model : undefined,
    },
    mcp: {
      servers: capabilities.servers,
      availableTools: capabilities.support.mcpTools.map((tool) => `${tool.server}/${tool.name}`),
      invokedTools: [],
      requests: plannedMcpRequests,
    },
    skills: {
      available: capabilities.availableSkills,
      activated: capabilities.activatedSkills,
    },
    warnings: capabilities.warnings,
  };
  return { ...draft, agentTrace: trace };
}

export async function runApprovedKnowledgeBridgeTools(request: ApprovedMcpAgentRequest): Promise<PaperBridgeDraft> {
  const trace = request.draft.agentTrace;
  const toolRequests = trace?.mcp.requests ?? [];
  const approved = new Set(request.approvedRequestIds);
  if (!trace || approved.size === 0 || !toolRequests.some((item) => approved.has(item.id))) return request.draft;
  if (!isTauriRuntime()) throw new Error("MCP 工具只能在 Knowledge Bridge 桌面端执行。");

  const configs = materializeMCPServers(await AIMCPStore.load()).filter((server) => server.enabled);
  const runtime = await prepareMCPTools(configs, { requireApproval: false });
  let orchestration;
  try {
    const liveToolNames = new Map(
      runtime.descriptors.map((descriptor) => [`${descriptor.serverName}\0${descriptor.name}`, descriptor.modelName]),
    );
    const executableRequests = toolRequests.map((item) => ({
      ...item,
      modelName: liveToolNames.get(`${item.server}\0${item.tool}`) ?? `unavailable:${item.id}`,
    }));
    orchestration = await executeApprovedMcpRequests(executableRequests, approved, runtime.tools);
  } finally {
    await runtime.close();
  }

  const capabilities = await loadAgentSupport(request.draft.input, request.projectUri);
  let refinedDraft = request.draft;
  const warnings = [...trace.warnings, ...capabilities.warnings];
  if (orchestration.grounding.length > 0 && request.connection.endpoint) {
    const candidate = await draftPaperBridge(
      request.draft.input,
      request.snapshot,
      request.draft.createdAt,
      request.connection,
      capabilities.support,
      orchestration.grounding,
    );
    if (candidate.provider === "remote-ai") {
      refinedDraft = candidate;
    } else if (candidate.diagnostic) {
      warnings.push(candidate.diagnostic);
    }
  }

  const invokedTools = [...new Set([...trace.mcp.invokedTools, ...orchestration.invokedTools])];
  return {
    ...refinedDraft,
    id: request.draft.id,
    input: request.draft.input,
    status: "draft",
    createdAt: request.draft.createdAt,
    agentTrace: {
      ...trace,
      completedAt: Date.now(),
      llm: {
        provider: refinedDraft.provider,
        model: request.connection.endpoint ? request.connection.model : undefined,
      },
      mcp: {
        ...trace.mcp,
        invokedTools,
        requests: orchestration.requests,
      },
      skills: {
        available: capabilities.availableSkills,
        activated: capabilities.activatedSkills,
      },
      warnings: [...new Set(warnings)],
    },
  };
}
