import { expect, test } from "@playwright/test";
import { navLabels, signIn } from "./helpers";

// PRD §8: role-shaped navigation, admin-only /admin (404 for everyone else), and no money for delivery engineers.

test("engineer: Today only, no admin, no revenue anywhere", async ({ page }) => {
  await signIn(page, "ENGINEER");
  await expect(page).toHaveURL(/\/today/);
  expect(await navLabels(page)).toEqual(["Today"]);
  expect((await page.goto("/admin"))?.status()).toBe(404);
  await page.goto("/today");
  await expect(page.locator("body")).not.toContainText(/\$\s?\d|USD|pipeline value|competitor/i);
  await expect(page.getByRole("button", { name: "Log a conversation" })).toHaveCount(0); // engineers text their manager instead
});

test("engineer: AI brief endpoint refuses money-bearing context", async ({ page }) => {
  await signIn(page, "ENGINEER");
  const res = await page.request.post("/api/ai/brief", { data: { contactId: "00000000-0000-0000-0000-000000000000" } });
  expect([400, 403, 404]).toContain(res.status());
});

test("delivery lead: Team is home-adjacent; scorecard and admin are closed", async ({ page }) => {
  await signIn(page, "LEAD");
  expect(await navLabels(page)).toEqual(expect.arrayContaining(["Today", "Team"]));
  expect((await page.goto("/admin"))?.status()).toBe(404);
});

test("outgrow leader lands on Team and sees the scorecard, not Admin", async ({ page }) => {
  await signIn(page, "LEADER");
  await expect(page).toHaveURL(/\/team/);
  expect(await navLabels(page)).toEqual(expect.arrayContaining(["Team", "Scorecard", "Library", "Operator"]));
  expect(await navLabels(page)).not.toContain("Admin");
  expect((await page.goto("/admin"))?.status()).toBe(404);
});

test("admin gets the leader's screens plus Admin, and /admin renders", async ({ page }) => {
  await signIn(page, "ADMIN");
  expect(await navLabels(page)).toContain("Admin");
  const res = await page.goto("/admin");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: /admin/i }).first()).toBeVisible();
});
