import { describe, expect, it, vi } from "vitest";
import type { McpToolRequest } from "./model";
import { executeApprovedMcpRequests } from "./mcpOrchestrator";

function request(id: string, modelName: string): McpToolRequest {
  return {
    id,
    server: "research",
    tool: modelName.replace("mcp__research__", ""),
    modelName,
    arguments: { query: id },
    reason: `Look up ${id}`,
    status: "pending-approval",
  };
}

describe("Knowledge Bridge MCP orchestration", () => {
  it("executes only requests explicitly approved by the user", async () => {
    const search = vi.fn(async (input) => ({ title: "Result", input }));
    const read = vi.fn(async () => ({ body: "Should not run" }));
    const requests = [request("request-1", "mcp__research__search"), request("request-2", "mcp__research__read")];

    const result = await executeApprovedMcpRequests(
      requests,
      new Set(["request-1"]),
      {
        mcp__research__search: { execute: search } as any,
        mcp__research__read: { execute: read } as any,
      },
      200,
    );

    expect(search).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
    expect(result.invokedTools).toEqual(["research/search"]);
    expect(result.requests[0]).toMatchObject({ status: "completed", completedAt: 200 });
    expect(result.requests[1].status).toBe("pending-approval");
    expect(result.grounding[0]).toMatchObject({ requestId: "request-1", server: "research", tool: "search" });
  });

  it("records tool failures without treating them as grounding", async () => {
    const result = await executeApprovedMcpRequests(
      [request("request-1", "mcp__research__search")],
      new Set(["request-1"]),
      { mcp__research__search: { execute: vi.fn(async () => Promise.reject(new Error("offline"))) } as any },
      300,
    );

    expect(result.requests[0]).toMatchObject({ status: "failed", error: "offline", completedAt: 300 });
    expect(result.grounding).toEqual([]);
  });

  it("validates model-proposed arguments before invoking a tool", async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const result = await executeApprovedMcpRequests(
      [request("request-1", "mcp__research__search")],
      new Set(["request-1"]),
      {
        mcp__research__search: {
          inputSchema: {
            "~standard": { validate: vi.fn(() => ({ issues: [{ message: "query must be a DOI" }] })) },
          },
          execute,
        } as any,
      },
      400,
    );

    expect(execute).not.toHaveBeenCalled();
    expect(result.invokedTools).toEqual([]);
    expect(result.requests[0]).toMatchObject({ status: "failed", error: "query must be a DOI" });
  });
});
