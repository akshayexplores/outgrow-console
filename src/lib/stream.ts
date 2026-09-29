/** Reads a plain-text streamed response (our /api/ai/* routes) and reports each piece. Errors come back as JSON { message }. */
export async function streamText(url: string, body: unknown, onText: (soFar: string) => void, signal?: AbortSignal): Promise<{ ok: true } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") return { ok: false, message: "" };
    return { ok: false, message: "Couldn't reach the server. Check your connection and try again." };
  }
  if (!res.ok || !res.body) {
    const j = (await res.json().catch(() => null)) as { message?: string } | null;
    return { ok: false, message: j?.message ?? "The operator couldn't answer just now." };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let acc = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      acc += dec.decode(value, { stream: true });
      onText(acc);
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return { ok: false, message: "" };
    return { ok: false, message: "The answer was interrupted. Try again." };
  }
  return { ok: true };
}
