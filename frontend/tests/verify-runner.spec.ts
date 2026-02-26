import { test, expect } from "@playwright/test";

const RUNNER_URL = "http://localhost:1420";

test("Runner check-builder page loads", async ({ page }) => {
  // Set localStorage to navigate to check-builder tab
  await page.goto(RUNNER_URL);
  await page.evaluate(() => {
    localStorage.setItem("qontinui-main-active-tab", "check-builder");
  });
  await page.reload();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "/tmp/runner-checks.png", fullPage: false });

  // Check the page has content
  const body = await page.textContent("body");
  console.log('Page contains "Checks":', body?.includes("Checks"));
  console.log('Page contains "New":', body?.includes("New"));
  console.log('Page contains "Search":', body?.includes("Search"));
});

test("Runner shell-command-builder page loads", async ({ page }) => {
  await page.goto(RUNNER_URL);
  await page.evaluate(() => {
    localStorage.setItem("qontinui-main-active-tab", "shell-command-builder");
  });
  await page.reload();
  await page.waitForTimeout(3000);
  await page.screenshot({
    path: "/tmp/runner-shell-commands.png",
    fullPage: false,
  });
  const body = await page.textContent("body");
  console.log(
    'Page contains "Shell Commands":',
    body?.includes("Shell Commands")
  );
});

test("Runner task-builder page loads", async ({ page }) => {
  await page.goto(RUNNER_URL);
  await page.evaluate(() => {
    localStorage.setItem("qontinui-main-active-tab", "task-builder");
  });
  await page.reload();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "/tmp/runner-tasks.png", fullPage: false });
  const body = await page.textContent("body");
  console.log('Page contains "Tasks":', body?.includes("Tasks"));
});

test("Runner context-builder page loads", async ({ page }) => {
  await page.goto(RUNNER_URL);
  await page.evaluate(() => {
    localStorage.setItem("qontinui-main-active-tab", "context-builder");
  });
  await page.reload();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "/tmp/runner-contexts.png", fullPage: false });
  const body = await page.textContent("body");
  console.log('Page contains "Contexts":', body?.includes("Contexts"));
});

test("Runner playwright-test-builder page loads", async ({ page }) => {
  await page.goto(RUNNER_URL);
  await page.evaluate(() => {
    localStorage.setItem("qontinui-main-active-tab", "playwright-test-builder");
  });
  await page.reload();
  await page.waitForTimeout(3000);
  await page.screenshot({
    path: "/tmp/runner-playwright-tests.png",
    fullPage: false,
  });
  const body = await page.textContent("body");
  console.log(
    'Page contains "Playwright Tests":',
    body?.includes("Playwright Tests")
  );
});
