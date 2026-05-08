/**
 * End-to-end tests for Runner documentation pages
 *
 * Tests the public-facing Runner documentation:
 * - Runner overview (/docs/runner) - capabilities, system requirements, nav links
 * - Installation (/docs/runner/installation) - platform sections, checksums
 * - Execution (/docs/runner/execution) - execution modes, settings
 * - Monitoring (/docs/runner/monitoring) - log files, log levels
 * - Multi-monitor (/docs/runner/multi-monitor) - coordinate system, monitor selection
 * - Troubleshooting (/docs/runner/troubleshooting) - issue categories, error codes
 * - AI Integration (/docs/runner/ai-integration) - MCP docs, description format
 * - Workflow Descriptions (/docs/runner/workflow-descriptions) - writing tips, JSON format
 *
 * These pages do not require authentication.
 */

import { test, expect } from "@playwright/test";

test.describe("Runner Overview (/docs/runner)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/docs/runner");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/docs-runner-overview.png",
      fullPage: true,
    });
  });

  test("displays main heading and description", async ({ page }) => {
    await page.goto("/docs/runner");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", {
      name: /qontinui runner/i,
      level: 1,
    });
    await expect(heading).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByText(
        "Desktop application for orchestrating AI coding sessions with automated feedback loops"
      )
    ).toBeVisible();
  });

  test("shows key capabilities", async ({ page }) => {
    await page.goto("/docs/runner");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByText("Actual mouse clicks and keyboard input")
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText("Real image recognition using OpenCV")
    ).toBeVisible();
    await expect(
      page.getByText("Multi-monitor support", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText("Live execution monitoring and logs")
    ).toBeVisible();
  });

  test("shows system requirements for all platforms", async ({ page }) => {
    await page.goto("/docs/runner");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /system requirements/i })
    ).toBeVisible({ timeout: 10000 });

    // Platform names in the requirements cards
    const windowsHeading = page.locator("h3", { hasText: "Windows" });
    await expect(windowsHeading).toBeVisible();

    const macosHeading = page.locator("h3", { hasText: "macOS" });
    await expect(macosHeading).toBeVisible();

    const linuxHeading = page.locator("h3", { hasText: "Linux" });
    await expect(linuxHeading).toBeVisible();
  });

  test("shows documentation section links to sub-pages", async ({ page }) => {
    await page.goto("/docs/runner");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /documentation sections/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByRole("link", { name: /installation/i }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /running automations/i })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /monitoring/i })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /multi-monitor/i })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /troubleshooting/i })
    ).toBeVisible();
  });

  test("shows Key Features section", async ({ page }) => {
    await page.goto("/docs/runner");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /key features/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("Visual Execution Monitoring")).toBeVisible();
    await expect(page.getByText("Comprehensive Logging")).toBeVisible();
    await expect(page.getByText("Graceful Error Handling")).toBeVisible();
  });

  test("has download CTA", async ({ page }) => {
    await page.goto("/docs/runner");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("link", { name: /download runner/i }).first()
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Runner Installation (/docs/runner/installation)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/docs/runner/installation");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/docs-runner-installation.png",
      fullPage: true,
    });
  });

  test("displays page title", async ({ page }) => {
    await page.goto("/docs/runner/installation");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", {
      name: /runner installation guide/i,
    });
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("shows Windows installation section", async ({ page }) => {
    await page.goto("/docs/runner/installation");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /windows installation/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("Standard Installation").first()).toBeVisible();
    await expect(page.getByText("Handle SmartScreen warning")).toBeVisible();
  });

  test("shows macOS installation section", async ({ page }) => {
    await page.goto("/docs/runner/installation");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /macos installation/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByText("First launch (Gatekeeper workaround)")
    ).toBeVisible();
  });

  test("shows Linux installation section", async ({ page }) => {
    await page.goto("/docs/runner/installation");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /linux installation/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("AppImage Installation")).toBeVisible();
    await expect(page.getByText("Make it executable")).toBeVisible();
  });

  test("shows checksum verification section", async ({ page }) => {
    await page.goto("/docs/runner/installation");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /verifying your download/i })
    ).toBeVisible({ timeout: 10000 });

    // Checksum commands
    await expect(page.getByText("Get-FileHash")).toBeVisible();
    await expect(page.getByText("shasum -a 256")).toBeVisible();
  });

  test("shows troubleshooting section", async ({ page }) => {
    await page.goto("/docs/runner/installation");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /troubleshooting/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText(/Permission denied/i)).toBeVisible();
  });
});

test.describe("Runner Execution (/docs/runner/execution)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/docs/runner/execution");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/docs-runner-execution.png",
      fullPage: true,
    });
  });

  test("displays page title", async ({ page }) => {
    await page.goto("/docs/runner/execution");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", {
      name: /running automations/i,
    });
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("shows 3 execution modes", async ({ page }) => {
    await page.goto("/docs/runner/execution");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /execution modes/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("Run from Initial State")).toBeVisible();
    await expect(page.getByText("Run Specific Process")).toBeVisible();
    await expect(page.getByText("Run from Custom State")).toBeVisible();
  });

  test("shows configurable execution settings", async ({ page }) => {
    await page.goto("/docs/runner/execution");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /execution settings/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByRole("heading", { name: "default_timeout" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "default_retry_count" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "action_delay" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "failure_strategy" })
    ).toBeVisible();
  });

  test("shows prerequisites section", async ({ page }) => {
    await page.goto("/docs/runner/execution");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /before you begin/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByText("Export Configuration from Qontinui Web")
    ).toBeVisible();
  });

  test("shows monitoring section", async ({ page }) => {
    await page.goto("/docs/runner/execution");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /monitoring execution/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("Real-Time Console Output")).toBeVisible();
    await expect(
      page.getByText("State Transition Visualization")
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Screenshot Capture" })
    ).toBeVisible();
  });

  test("shows best practices", async ({ page }) => {
    await page.goto("/docs/runner/execution");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /best practices/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByText("Test with mock execution first")
    ).toBeVisible();
  });
});

test.describe("Runner Monitoring (/docs/runner/monitoring)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/docs/runner/monitoring");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/docs-runner-monitoring.png",
      // Mobile Safari/WebKit caps screenshot canvas at 32767px;
      // long docs pages exceed that with fullPage: true.
      fullPage: false,
    });
  });

  test("displays page title", async ({ page }) => {
    await page.goto("/docs/runner/monitoring");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", {
      name: /monitoring/i,
      level: 1,
    });
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("shows log file structure documentation", async ({ page }) => {
    await page.goto("/docs/runner/monitoring");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /log file locations/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByRole("heading", { name: "runner-frontend.log" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "runner-backend.log" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "ai-output.jsonl" })
    ).toBeVisible();
  });

  test("shows log levels documentation", async ({ page }) => {
    await page.goto("/docs/runner/monitoring");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: "Log Levels", exact: true })
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("DEBUG", { exact: true })).toBeVisible();
    await expect(page.getByText("INFO", { exact: true })).toBeVisible();
    await expect(page.getByText("WARN", { exact: true })).toBeVisible();
    await expect(page.getByText("ERROR", { exact: true })).toBeVisible();
  });

  test("shows real-time monitoring section", async ({ page }) => {
    await page.goto("/docs/runner/monitoring");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /real-time monitoring/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByRole("heading", { name: "General Logs" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Image Recognition Logs" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Action Logs" })
    ).toBeVisible();
  });

  test("shows health monitoring section", async ({ page }) => {
    await page.goto("/docs/runner/monitoring");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /health monitoring/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("Ping/Pong Health Checks")).toBeVisible();
    await expect(page.getByText("Process Monitoring")).toBeVisible();
    await expect(page.getByText("Performance Tracking")).toBeVisible();
  });

  test("shows debugging tips", async ({ page }) => {
    await page.goto("/docs/runner/monitoring");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /debugging tips/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByText("Check logs immediately after errors")
    ).toBeVisible();
  });
});

test.describe("Runner Multi-Monitor (/docs/runner/multi-monitor)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/docs/runner/multi-monitor");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/docs-runner-multi-monitor.png",
      fullPage: true,
    });
  });

  test("displays page title", async ({ page }) => {
    await page.goto("/docs/runner/multi-monitor");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", {
      name: /multi-monitor support/i,
    });
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("shows virtual desktop coordinate system docs", async ({ page }) => {
    await page.goto("/docs/runner/multi-monitor");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByText("Virtual Desktop Coordinate System")
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByText(/primary monitor is typically at position/i)
    ).toBeVisible();
  });

  test("shows monitor detection documentation", async ({ page }) => {
    await page.goto("/docs/runner/multi-monitor");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("Monitor Detection")).toBeVisible({
      timeout: 10000,
    });

    await expect(page.getByText(/monitor index/i)).toBeVisible();
    await expect(page.getByText(/primary monitor designation/i)).toBeVisible();
  });

  test("shows monitor selection methods", async ({ page }) => {
    await page.goto("/docs/runner/multi-monitor");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /selecting monitors/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("Visual Selection (Runner UI)")).toBeVisible();
    await expect(page.getByText("By Position (MCP/API)")).toBeVisible();
    await expect(page.getByText("By Index (MCP/API)")).toBeVisible();
  });

  test("shows bounding region capture concept", async ({ page }) => {
    await page.goto("/docs/runner/multi-monitor");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("Bounding Region Capture")).toBeVisible({
      timeout: 10000,
    });
  });

  test("shows common use cases", async ({ page }) => {
    await page.goto("/docs/runner/multi-monitor");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /common use cases/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("Trading Dashboards")).toBeVisible();
    await expect(page.getByText("Multi-Application Workflows")).toBeVisible();
  });
});

test.describe("Runner Troubleshooting (/docs/runner/troubleshooting)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/docs/runner/troubleshooting");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/docs-runner-troubleshooting.png",
      fullPage: false,
    });
  });

  test("displays page title", async ({ page }) => {
    await page.goto("/docs/runner/troubleshooting");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", {
      name: /troubleshooting/i,
    });
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("shows 4 issue categories", async ({ page }) => {
    await page.goto("/docs/runner/troubleshooting");
    await page.waitForLoadState("domcontentloaded");

    // Installation Issues
    await expect(
      page.getByRole("heading", { name: /installation issues/i })
    ).toBeVisible({ timeout: 10000 });

    // Connection Issues
    await expect(
      page.getByRole("heading", { name: /connection issues/i })
    ).toBeVisible();

    // Execution Issues
    await expect(
      page.getByRole("heading", { name: /execution issues/i })
    ).toBeVisible();

    // Performance Issues
    await expect(
      page.getByRole("heading", { name: /performance issues/i })
    ).toBeVisible();
  });

  test("shows quick diagnostics section", async ({ page }) => {
    await page.goto("/docs/runner/troubleshooting");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /quick diagnostics/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByRole("heading", { name: "Check Logs" })
    ).toBeVisible();
    await expect(page.getByText("Verify Display")).toBeVisible();
    await expect(page.getByText("Check Permissions")).toBeVisible();
    await expect(page.getByText("Validate Config")).toBeVisible();
  });

  test("shows error codes reference", async ({ page }) => {
    await page.goto("/docs/runner/troubleshooting");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /error codes reference/i })
    ).toBeVisible({ timeout: 10000 });

    // Some error codes
    await expect(page.getByText("CONFIG_001")).toBeVisible();
    await expect(page.getByText("EXEC_001").first()).toBeVisible();
    await expect(page.getByText("COMM_001")).toBeVisible();
    await expect(page.getByText("HEALTH_001")).toBeVisible();
  });

  test("shows installation issues with error codes", async ({ page }) => {
    await page.goto("/docs/runner/troubleshooting");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("INSTALL_001")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("INSTALL_002")).toBeVisible();
    await expect(page.getByText("INSTALL_003")).toBeVisible();
  });

  test("shows platform-specific issues", async ({ page }) => {
    await page.goto("/docs/runner/troubleshooting");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /platform-specific issues/i })
    ).toBeVisible({ timeout: 10000 });
  });

  test("shows advanced debugging section", async ({ page }) => {
    await page.goto("/docs/runner/troubleshooting");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /advanced debugging/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("Enable Verbose Logging")).toBeVisible();
    await expect(page.getByText("Capture Execution Screenshots")).toBeVisible();
    await expect(page.getByText("Test Individual Actions")).toBeVisible();
  });
});

test.describe("Runner AI Integration (/docs/runner/ai-integration)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/docs/runner/ai-integration");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/docs-runner-ai-integration.png",
      fullPage: true,
    });
  });

  test("displays page title", async ({ page }) => {
    await page.goto("/docs/runner/ai-integration");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", {
      name: /ai integration/i,
    });
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("shows MCP integration documentation", async ({ page }) => {
    await page.goto("/docs/runner/ai-integration");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /mcp server integration/i })
    ).toBeVisible({ timeout: 10000 });

    // MCP commands reference
    await expect(page.getByText("mcp__qontinui__load_config")).toBeVisible();
    await expect(page.getByText("mcp__qontinui__run_workflow")).toBeVisible();
  });

  test("shows structured description format", async ({ page }) => {
    await page.goto("/docs/runner/ai-integration");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /description format/i })
    ).toBeVisible({ timeout: 10000 });

    // Format fields
    await expect(page.getByRole("cell", { name: "Use when" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Verifies" })).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "Prerequisites" })
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "Success indicators" })
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "Failure indicators" })
    ).toBeVisible();
  });

  test("shows why workflow descriptions matter", async ({ page }) => {
    await page.goto("/docs/runner/ai-integration");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", {
        name: /why workflow descriptions matter/i,
      })
    ).toBeVisible({ timeout: 10000 });
  });

  test("shows workflow examples", async ({ page }) => {
    await page.goto("/docs/runner/ai-integration");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByRole("heading", { name: /examples/i })).toBeVisible({
      timeout: 10000,
    });

    await expect(
      page.getByText("Example 1: Navigation Workflow")
    ).toBeVisible();
    await expect(
      page.getByText("Example 2: Data-Producing Workflow")
    ).toBeVisible();
    await expect(
      page.getByText("Example 3: Workflow with Dependencies")
    ).toBeVisible();
  });

  test("shows best practices with Do and Don't", async ({ page }) => {
    await page.goto("/docs/runner/ai-integration");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /best practices/i })
    ).toBeVisible({ timeout: 10000 });

    // Do/Don't sections
    const doHeading = page.locator("h3", { hasText: /^Do$/ });
    await expect(doHeading).toBeVisible();

    const dontHeading = page.locator("h3", { hasText: /Don/ });
    await expect(dontHeading).toBeVisible();
  });
});

test.describe("Runner Workflow Descriptions (/docs/runner/workflow-descriptions)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/docs/runner/workflow-descriptions");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/docs-runner-workflow-descriptions.png",
      fullPage: false,
    });
  });

  test("displays page title", async ({ page }) => {
    await page.goto("/docs/runner/workflow-descriptions");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", {
      name: /writing workflow descriptions/i,
    });
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("shows writing tips section", async ({ page }) => {
    await page.goto("/docs/runner/workflow-descriptions");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("Start with the Action")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Be Specific About State")).toBeVisible();
    await expect(page.getByText("Make Indicators Observable")).toBeVisible();
    await expect(page.getByText("Link Related Workflows")).toBeVisible();
  });

  test("shows JSON format example", async ({ page }) => {
    await page.goto("/docs/runner/workflow-descriptions");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /json format example/i })
    ).toBeVisible({ timeout: 10000 });

    // JSON code example content
    await expect(
      page.getByText("workflow-navigate-state-machine")
    ).toBeVisible();
  });

  test("shows workflow categories table", async ({ page }) => {
    await page.goto("/docs/runner/workflow-descriptions");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /workflow categories/i })
    ).toBeVisible({ timeout: 10000 });

    // Category names in the table — use exact match because some descriptions
    // (e.g., "State machine transitions") would otherwise match by substring
    // and trigger strict-mode violations.
    await expect(
      page.getByRole("cell", { name: "Main", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "Testing", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "UI Automation", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "Utilities", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "Transitions", exact: true })
    ).toBeVisible();
  });

  test("shows structured description format", async ({ page }) => {
    await page.goto("/docs/runner/workflow-descriptions");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", {
        name: /structured description format/i,
      })
    ).toBeVisible({ timeout: 10000 });

    // Field reference table
    await expect(page.getByText("Field Reference")).toBeVisible();
  });

  test("shows best practices with Do and Don't", async ({ page }) => {
    await page.goto("/docs/runner/workflow-descriptions");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /best practices/i })
    ).toBeVisible({ timeout: 10000 });

    const doHeading = page.locator("h3", { hasText: /^Do$/ });
    await expect(doHeading).toBeVisible();

    const dontHeading = page.locator("h3", { hasText: /Don/ });
    await expect(dontHeading).toBeVisible();
  });

  test("shows multi-workflow sequences section", async ({ page }) => {
    await page.goto("/docs/runner/workflow-descriptions");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", {
        name: /multi-workflow sequences/i,
      })
    ).toBeVisible({ timeout: 10000 });
  });
});
