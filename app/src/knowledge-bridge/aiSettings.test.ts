import { describe, expect, it } from "vitest";
import { normalizeAiConnection } from "./aiSettings";

describe("AI connection settings", () => {
  it("normalizes a chat-completions URL into an API base URL", () => {
    expect(
      normalizeAiConnection({
        endpoint: " https://example.test/v1/chat/completions/ ",
        model: " ",
        apiKey: " secret ",
      }),
    ).toEqual({ endpoint: "https://example.test/v1", model: "gpt-4.1-mini", apiKey: "secret" });
  });
});
