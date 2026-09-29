import { createHash } from "node:crypto";

/** RFC 4122 v5 (name-based) UUID. Seeds use it so re-running the seed produces the same ids (idempotent, diff-able). */
export function uuidv5(name: string, namespace = "6f1c2b7e-3a51-4c1e-9d0a-5b0f6c7d8e91"): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(ns).update(name, "utf8").digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
