import { expect, test } from "@playwright/test";

// Signed-out surface. Runs against any deployment with no credentials.

test.describe("signed out", () => {
  test("every app route sends you to /login and remembers where you were going", async ({ page }) => {
    for (const path of ["/today", "/accounts", "/team", "/scorecard", "/library", "/operator", "/admin"]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    }
  });

  test("/ goes to /login without a next parameter", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("/admin never reveals that it exists to a signed-out visitor", async ({ page }) => {
    const res = await page.goto("/admin");
    expect(res?.status()).toBe(200); // it is the login page after the redirect
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByText(/admin/i)).toHaveCount(0);
  });

  test("AI endpoints answer signed-out callers with JSON 401, not HTML", async ({ request }) => {
    for (const path of ["/api/ai/brief", "/api/ai/coach"]) {
      const res = await request.post(path, { data: {} });
      expect(res.status()).toBe(401);
      expect(res.headers()["content-type"]).toContain("application/json");
      expect(res.headers()["cache-control"]).toContain("no-store");
    }
  });

  test("security headers are set", async ({ request }) => {
    const res = await request.get("/login");
    const h = res.headers();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["strict-transport-security"]).toContain("max-age");
    expect(h["referrer-policy"]).toBeTruthy();
    expect(h["x-powered-by"]).toBeUndefined();
  });

  test("unknown paths show the friendly 404", async ({ page }) => {
    // /login is public, so probe a path under a public prefix to reach the 404 page without signing in.
    const res = await page.goto("/auth/does-not-exist");
    expect(res?.status()).toBe(404);
  });
});

test.describe("login page", () => {
  test("offers a magic link first and an optional password", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible();
    await expect(page.getByLabel("Password")).toHaveCount(0);
    await page.getByRole("button", { name: "Use a password instead" }).click();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Email me a link instead" }).click();
    await expect(page.getByLabel("Password")).toHaveCount(0);
  });

  test("wrong password gives a plain message and no stack trace", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Use a password instead" }).click();
    await page.getByLabel("Email").fill("nobody@example.com");
    await page.getByLabel("Password").fill("not-a-real-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const err = page.locator(".errbox[role=alert]"); // not the framework's route announcer, which is also role=alert
    await expect(err).toBeVisible();
    await expect(err).not.toContainText(/error:|at .*\.(ts|js)|supabase/i);
  });

  test("has a title, a language and no horizontal scroll at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/login");
    await expect(page).toHaveTitle(/.+/);
    expect(await page.locator("html").getAttribute("lang")).toBeTruthy();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("form controls are labelled and reachable by keyboard", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Email")).toBeFocused(); // autofocus lands here first
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeFocused();
    const unlabelled = await page.evaluate(() =>
      [...document.querySelectorAll("input:not([type=hidden]), button, select, textarea")].filter((el) => !(el as HTMLElement).innerText?.trim() && !el.getAttribute("aria-label") && !el.id).length);
    expect(unlabelled).toBe(0);
  });

  test("first load is quick", async ({ page }) => {
    const t0 = Date.now();
    await page.goto("/login", { waitUntil: "load" });
    expect(Date.now() - t0).toBeLessThan(3000); // generous: the PRD target is p95 < 1.5 s on the deployed app, measured separately
  });
});
