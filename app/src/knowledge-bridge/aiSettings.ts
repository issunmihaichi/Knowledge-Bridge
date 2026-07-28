export interface AiConnectionSettings {
  endpoint: string;
  model: string;
  apiKey: string;
}

const SETTINGS_KEY = "knowledge-bridge.ai-connection";

function defaults(): AiConnectionSettings {
  return {
    endpoint: (import.meta.env.LR_AI_ENDPOINT as string | undefined)?.trim() ?? "",
    model: (import.meta.env.LR_AI_MODEL as string | undefined)?.trim() || "gpt-4.1-mini",
    apiKey: (import.meta.env.LR_AI_API_KEY as string | undefined)?.trim() ?? "",
  };
}

export function normalizeAiConnection(value: Partial<AiConnectionSettings>): AiConnectionSettings {
  return {
    endpoint: (value.endpoint ?? "").trim().replace(/\/?chat\/completions\/?$/, "").replace(/\/$/, ""),
    model: (value.model ?? "").trim() || "gpt-4.1-mini",
    apiKey: (value.apiKey ?? "").trim(),
  };
}

export function loadAiConnection(): AiConnectionSettings {
  const fallback = defaults();
  if (typeof localStorage === "undefined") return fallback;
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<AiConnectionSettings>;
    return normalizeAiConnection({ ...fallback, ...stored });
  } catch {
    return fallback;
  }
}

export function saveAiConnection(value: Partial<AiConnectionSettings>): AiConnectionSettings {
  const normalized = normalizeAiConnection(value);
  if (typeof localStorage !== "undefined") localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}

export function aiRequestHeaders(settings: AiConnectionSettings): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
  };
}
