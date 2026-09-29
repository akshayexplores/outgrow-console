import { expect, test, type Page } from "@playwright/test";

export type Persona = "ADMIN" | "ENGINEER" | "PM" | "LEAD" | "LEADER";

export function creds(p: Persona): { email: string; password: string } | null {
  const email = process.env[`E2E_${p}_EMAIL`];
  const password = process.env[`E2E_${p}_PASSWORD`];
  return email && password ? { email, password } : null;
}

/** Skip (never fail) when a persona's credentials are not configured. */
export function requirePersona(p: Persona) {
  const c = creds(p);
  test.skip(!c, `Set E2E_${p}_EMAIL and E2E_${p}_PASSWORD to run this spec`);
  return c!;
}

export async function signIn(page: Page, p: Persona) {
  const c = requirePersona(p);
  await page.goto("/login");
  await page.getByRole("button", { name: "Use a password instead" }).click();
  await page.getByLabel("Email").fill(c.email);
  await page.getByLabel("Password").fill(c.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export const navLabels = async (page: Page) => (await page.getByRole("navigation", { name: "Main" }).getByRole("link").allInnerTexts()).map((t) => t.replace(/\d+\s*$/, "").trim());
