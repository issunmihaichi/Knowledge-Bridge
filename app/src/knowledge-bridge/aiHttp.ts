import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

const DEFAULT_AI_TIMEOUT_MS = 30_000;

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Use Tauri's native HTTP client on desktop so AI calls are not blocked by WebView CORS. */
export async function fetchAi(input: string, init: RequestInit, timeoutMs = DEFAULT_AI_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const fetcher = isTauriRuntime() ? tauriFetch : globalThis.fetch;
    return await fetcher(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`AI request timed out after ${Math.round(timeoutMs / 1000)} seconds`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
