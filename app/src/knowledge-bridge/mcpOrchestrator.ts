import type { ToolSet } from "ai";
import type { McpToolRequest } from "./model";
import type { PaperBridgeMcpGrounding } from "./paperBridgeAi";

export interface McpOrchestrationResult {
  requests: McpToolRequest[];
  invokedTools: string[];
  grounding: PaperBridgeMcpGrounding[];
}

interface ExecutableTool {
  inputSchema?: {
    "~standard"?: {
      validate: (
        value: unknown,
      ) =>
        | { value: unknown; issues?: undefined }
        | { value?: undefined; issues: Array<{ message?: string }> }
        | Promise<{ value: unknown; issues?: undefined } | { value?: undefined; issues: Array<{ message?: string }> }>;
    };
  };
  execute?: (
    input: Record<string, unknown>,
    options: { toolCallId: string; messages: Array<{ role: "user"; content: string }> },
  ) => unknown;
}

async function validateToolInput(
  tool: ExecutableTool,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const validate = tool.inputSchema?.["~standard"]?.validate;
  if (!validate) return input;
  const result = await validate(input);
  if (result.issues?.length) {
    throw new Error(result.issues.map((issue) => issue.message ?? "Invalid tool input").join("; "));
  }
  return result.value as Record<string, unknown>;
}

function serializeResult(value: unknown, limit: number): string {
  let text: string;
  try {
    text =
      typeof value === "string"
        ? value
        : JSON.stringify(value, (_, item) => (typeof item === "bigint" ? String(item) : item));
  } catch {
    text = String(value);
  }
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated]`;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(value && typeof value === "object" && Symbol.asyncIterator in value);
}

async function resolveToolOutput(value: unknown): Promise<unknown> {
  const resolved = await value;
  if (!isAsyncIterable(resolved)) return resolved;
  const chunks: unknown[] = [];
  for await (const chunk of resolved) chunks.push(chunk);
  return chunks.length === 1 ? chunks[0] : chunks;
}

export async function executeApprovedMcpRequests(
  requests: McpToolRequest[],
  approvedRequestIds: ReadonlySet<string>,
  tools: ToolSet,
  now = Date.now(),
): Promise<McpOrchestrationResult> {
  const invokedTools: string[] = [];
  const grounding: PaperBridgeMcpGrounding[] = [];
  const nextRequests: McpToolRequest[] = [];

  for (const request of requests) {
    if (request.status !== "pending-approval" || !approvedRequestIds.has(request.id)) {
      nextRequests.push(request);
      continue;
    }

    const tool = tools[request.modelName] as ExecutableTool | undefined;
    if (!tool?.execute) {
      nextRequests.push({
        ...request,
        status: "failed",
        error: "MCP tool is unavailable or not executable.",
        completedAt: now,
      });
      continue;
    }

    const qualifiedName = `${request.server}/${request.tool}`;
    try {
      const input = await validateToolInput(tool, request.arguments);
      const execution = tool.execute(input, {
        toolCallId: request.id,
        messages: [{ role: "user", content: `Knowledge Bridge approved MCP request: ${request.reason}` }],
      });
      invokedTools.push(qualifiedName);
      const output = await resolveToolOutput(execution);
      const fullResult = serializeResult(output, 6000);
      nextRequests.push({
        ...request,
        status: "completed",
        resultPreview: serializeResult(output, 1200),
        completedAt: now,
      });
      grounding.push({
        requestId: request.id,
        server: request.server,
        tool: request.tool,
        result: fullResult,
      });
    } catch (error) {
      nextRequests.push({
        ...request,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        completedAt: now,
      });
    }
  }

  return { requests: nextRequests, invokedTools, grounding };
}

export function rejectPendingMcpRequests(
  requests: McpToolRequest[],
  rejectedRequestIds: ReadonlySet<string>,
  now = Date.now(),
): McpToolRequest[] {
  return requests.map((request) =>
    request.status === "pending-approval" && rejectedRequestIds.has(request.id)
      ? { ...request, status: "rejected", completedAt: now }
      : request,
  );
}
