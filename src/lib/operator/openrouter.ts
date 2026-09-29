import "server-only";
/**
 * Thin OpenRouter client. The API key is read from the server environment only and never leaves this module.
 * OpenRouter is OpenAI-compatible: https://openrouter.ai/api/v1/chat/completions
 */
import type { Msg } from "@/lib/operator/types";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export interface ChatOptions {
  apiKey: string;
  referer: string;
  model: string;
  messages: Msg[];
  temperature: number;
  maxTokens: number;
  json?: boolean;
  timeoutMs: number;
}

export interface ChatUsage { tokensIn: number | null; tokensOut: number | null; costUsd: number | null }
export interface ChatResult extends ChatUsage { text: string }

export class OpenRouterError extends Error {
  constructor(message: string, readonly kind: "timeout" | "http" | "network" | "empty", readonly status?: number) {
    super(message);
    this.name = "OpenRouterError";
  }
}

function headers(o: Pick<ChatOptions, "apiKey" | "referer">): Record<string, string> {
  return {
    Authorization: `Bearer ${o.apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": o.referer,
    "X-Title": "Outgrow Console",
  };
}

function body(o: ChatOptions, stream: boolean): string {
  return JSON.stringify({
    model: o.model,
    messages: o.messages,
    temperature: o.temperature,
    max_tokens: o.maxTokens,
    usage: { include: true },
    ...(stream ? { stream: true } : {}),
    ...(o.json ? { response_format: { type: "json_object" } } : {}),
  });
}

function usageOf(u: unknown): ChatUsage {
  const r = (u ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return { tokensIn: n(r.prompt_tokens), tokensOut: n(r.completion_tokens), costUsd: n(r.cost) };
}

async function post(o: ChatOptions, stream: boolean, signal: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, { method: "POST", headers: headers(o), body: body(o, stream), signal });
  } catch (e) {
    if (signal.aborted) throw new OpenRouterError("The model took too long to answer.", "timeout");
    throw new OpenRouterError(`Network error talking to OpenRouter: ${(e as Error).message}`, "network");
  }
  if (!res.ok) {
    // The response text is kept short and never contains the key (it isn't echoed by OpenRouter).
    const text = (await res.text().catch(() => "")).slice(0, 300);
    throw new OpenRouterError(`OpenRouter answered ${res.status}: ${text}`, "http", res.status);
  }
  return res;
}

/** One non-streamed completion. */
export async function chat(o: ChatOptions): Promise<ChatResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), o.timeoutMs);
  try {
    const res = await post(o, false, ac.signal);
    const j = (await res.json()) as { choices?: { message?: { content?: unknown } }[]; usage?: unknown };
    const content = j.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content : "";
    if (!text.trim()) throw new OpenRouterError("The model returned an empty answer.", "empty");
    return { text, ...usageOf(j.usage) };
  } catch (e) {
    if (e instanceof OpenRouterError) throw e;
    if (ac.signal.aborted) throw new OpenRouterError("The model took too long to answer.", "timeout");
    throw new OpenRouterError(`Unreadable answer from OpenRouter: ${(e as Error).message}`, "network");
  } finally {
    clearTimeout(timer);
  }
}

export type StreamEvent = { delta: string } | { usage: ChatUsage };

/** A streamed completion (server-sent events). The timeout applies until the first token arrives, then to the whole answer. */
export async function* streamChat(o: ChatOptions): AsyncGenerator<StreamEvent> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), o.timeoutMs);
  try {
    const res = await post(o, true, ac.signal);
    if (!res.body) throw new OpenRouterError("The model returned no stream.", "empty");
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let any = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue; // comments like ": OPENROUTER PROCESSING" and blank lines
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let j: { choices?: { delta?: { content?: unknown } }[]; usage?: unknown; error?: { message?: string } };
        try { j = JSON.parse(data); } catch { continue; }
        if (j.error) throw new OpenRouterError(j.error.message ?? "The model stopped with an error.", "http");
        const d = j.choices?.[0]?.delta?.content;
        if (typeof d === "string" && d) { any = true; yield { delta: d }; }
        if (j.usage) yield { usage: usageOf(j.usage) };
      }
    }
    if (!any) throw new OpenRouterError("The model returned an empty answer.", "empty");
  } catch (e) {
    if (e instanceof OpenRouterError) throw e;
    if (ac.signal.aborted) throw new OpenRouterError("The model took too long to answer.", "timeout");
    throw new OpenRouterError(`Stream interrupted: ${(e as Error).message}`, "network");
  } finally {
    clearTimeout(timer);
  }
}
