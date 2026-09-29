/** Only same-site relative paths are allowed as a post-login destination (blocks open redirects). */
export function safeNext(next: unknown): string | null {
  if (typeof next !== "string") return null;
  return next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : null;
}
