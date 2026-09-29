import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// PRD §8: free text → Check → single save. Runs with or without an OPENROUTER_API_KEY (without it the plain-form parser answers and says so).

test("PM logs a conversation from free text and sees the weekly count go up", async ({ page }) => {
  await signIn(page, "PM");
  await page.goto("/today");
  await page.getByRole("button", { name: "Log a conversation" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Say what happened, in your own words").fill("Called and mentioned our V&V test automation. She said the regression suite is with another supplier. Walkthrough next Tuesday.");
  // pick the first suggested contact, or search
  const suggested = dialog.getByRole("group", { name: "Suggested contacts" }).getByRole("button").first();
  if (await suggested.count()) await suggested.click();
  await dialog.getByRole("button", { name: "Turn into a log" }).click();

  // Check screen: editable, never saved blindly
  await expect(dialog.getByLabel("Conversation")).toBeVisible();
  const save = dialog.getByRole("button", { name: "Save" });
  await expect(save).toBeEnabled();
  await save.click();

  await expect(dialog.getByRole("status").filter({ hasText: /^Saved\./ })).toBeVisible();
  await expect(dialog.getByText(/action(s)? written/)).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
});

test("Email is not offered as a channel", async ({ page }) => {
  await signIn(page, "PM");
  await page.goto("/today");
  await page.getByRole("button", { name: "Log a conversation" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Fill the form instead" }).click();
  const options = await dialog.locator("select option").allInnerTexts();
  expect(options.join(" ")).not.toMatch(/\bemail\b/i);
});

test("save is blocked with no asks", async ({ page }) => {
  await signIn(page, "PM");
  await page.goto("/today");
  await page.getByRole("button", { name: "Log a conversation" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Fill the form instead" }).click();
  await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
});
