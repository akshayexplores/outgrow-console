export const money = (v: number | null | undefined) =>
  v === null || v === undefined ? "" : "$" + Math.round(v).toLocaleString("en-US");

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((x) => x[0]).join("").slice(0, 2).toUpperCase();

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
