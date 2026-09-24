import { test, expect } from "@playwright/test";
test("project isolation, remembered failures, baseline, and outdated memory", async ({
  page,
  context,
}) => {
  test.skip(
    process.env.FIXTRAIL_TEST_LIVE !== "1",
    "Requires live providers; makes paid API calls",
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Pick up where you left off." }),
  ).toBeVisible();
  await page.screenshot({
    path: "/private/tmp/fixtrail-desktop.png",
    fullPage: true,
  });
  const composer = page.getByRole("textbox", { name: "Message FixTrail" });
  await composer.fill(
    "I tried deleting the build directory but it failed to fix the dependency error.",
  );
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(".memory-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await composer.fill("The dependency error is back.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText("Used 1 earlier memory")).toBeVisible();
  await page.getByRole("button", { name: "Memory on", exact: true }).click();
  await composer.fill("The dependency error is back.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(".message.assistant")).toHaveCount(1);
  await expect(page.getByText("Used 1 earlier memory")).toHaveCount(0);
  await page.getByRole("button", { name: "Outdated", exact: true }).click();
  await expect(page.locator(".memory-card")).toHaveCount(0);
  const second = await context.browser()!.newContext();
  const other = await second.newPage();
  await other.goto("/");
  await expect(other.getByText("Nothing lost. Nothing yet.")).toBeVisible();
  await second.close();
});
test("mobile layout and project creation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Pick up where you left off." }),
  ).toBeVisible();
  await page.screenshot({
    path: "/private/tmp/fixtrail-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Move test project");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.locator(".breadcrumb")).toContainText("Move test project");
});
