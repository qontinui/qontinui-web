/**
 * End-to-end tests for Web documentation pages
 *
 * Tests the public-facing Qontinui Web documentation:
 * - Web overview (/docs/web) - model-based approach, 6-step workflow
 * - Actions (/docs/web/actions) - 7 action categories
 * - AI Actions (/docs/web/ai-actions) - AI_PROMPT documentation
 * - Image Recognition (/docs/web/image-recognition) - template matching, thresholds
 * - Keyboard Shortcuts (/docs/web/keyboard-shortcuts) - shortcut reference
 * - States (/docs/web/states) - state concept, properties
 * - Transitions (/docs/web/transitions) - transition types, properties
 *
 * These pages do not require authentication.
 */

import { test, expect } from "@playwright/test";

test.describe("Web Overview (/docs/web)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/docs/web");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/docs-web-overview.png",
      fullPage: true,
    });
  });

  test("displays page title and description", async ({ page }) => {
    await page.goto("/docs/web");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", {
      name: /qontinui web/i,
      level: 1,
    });
    await expect(heading).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByText(
        "Visual configuration builder for creating intelligent GUI automation workflows"
      )
    ).toBeVisible();
  });

  test("shows model-based approach description with 4 concepts", async ({
    page,
  }) => {
    await page.goto("/docs/web");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /what is qontinui web/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("model-based approach")).toBeVisible();

    // 4 core concepts: States, Actions, Transitions, Images
    const statesItem = page.locator("li", {
      hasText: /States.*different screens or conditions/i,
    });
    await expect(statesItem).toBeVisible();

    const actionsItem = page.locator("li", {
      hasText: /Actions.*operations to perform/i,
    });
    await expect(actionsItem).toBeVisible();

    const transitionsItem = page.locator("li", {
      hasText: /Transitions.*how to navigate/i,
    });
    await expect(transitionsItem).toBeVisible();

    const imagesItem = page.locator("li", {
      hasText: /Images.*visual elements/i,
    });
    await expect(imagesItem).toBeVisible();
  });

  test("shows 6-step typical workflow", async ({ page }) => {
    await page.goto("/docs/web");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /typical workflow/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("Create Your Project")).toBeVisible();
    await expect(page.getByText("Define States")).toBeVisible();
    await expect(page.getByText("Upload Identifying Images")).toBeVisible();
    await expect(page.getByText("Add Transitions")).toBeVisible();
    await expect(page.getByText("Test with Mock Execution")).toBeVisible();
    await expect(page.getByText("Export Configuration")).toBeVisible();
  });

  test("shows documentation section links", async ({ page }) => {
    await page.goto("/docs/web");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /documentation sections/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByRole("link", { name: /working with states/i })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /action types/i })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /ai actions/i })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /state transitions/i })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /keyboard shortcuts/i })
    ).toBeVisible();
  });

  test("shows key concepts section", async ({ page }) => {
    await page.goto("/docs/web");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /key concepts/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("Model-Based Automation")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "State Identification" })
    ).toBeVisible();
    await expect(page.getByText("Visual Action Targeting")).toBeVisible();
  });

  test("shows advanced features", async ({ page }) => {
    await page.goto("/docs/web");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /advanced features/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("Parallel States")).toBeVisible();
    await expect(page.getByText("Conditional Actions")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Image Library" })
    ).toBeVisible();
    await expect(page.getByText("Export/Import")).toBeVisible();
  });
});

test.describe("Web Actions (/docs/web/actions)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/docs/web/actions");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/docs-web-actions.png",
      fullPage: true,
    });
  });

  test("displays page title", async ({ page }) => {
    await page.goto("/docs/web/actions");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", { name: /action types/i });
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("shows 7 action categories", async ({ page }) => {
    await page.goto("/docs/web/actions");
    await page.waitForLoadState("domcontentloaded");

    // All 7 categories as h2 headings
    await expect(
      page.getByRole("heading", { name: /^find actions$/i })
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole("heading", { name: /^mouse actions$/i })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /^keyboard actions$/i })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /^control flow actions$/i })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /^data actions$/i })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /^state actions$/i })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /^code actions$/i })
    ).toBeVisible();
  });

  test("shows Find actions: Find, Vanish, RAG Find", async ({ page }) => {
    await page.goto("/docs/web/actions");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("FIND", { exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("VANISH", { exact: true })).toBeVisible();
    await expect(page.getByText("RAG_FIND", { exact: true })).toBeVisible();
  });

  test("shows Mouse actions: Click, Mouse Move, Drag, Scroll", async ({
    page,
  }) => {
    await page.goto("/docs/web/actions");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("CLICK", { exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("MOUSE_MOVE", { exact: true })).toBeVisible();
    await expect(page.getByText("DRAG", { exact: true })).toBeVisible();
    await expect(page.getByText("SCROLL", { exact: true })).toBeVisible();
  });

  test("shows Keyboard actions: Type, Key Press, Hotkey", async ({ page }) => {
    await page.goto("/docs/web/actions");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("TYPE", { exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("KEY_PRESS", { exact: true })).toBeVisible();
    await expect(page.getByText("HOTKEY", { exact: true })).toBeVisible();
  });

  test("shows Control Flow actions: If, Loop, Switch, Try/Catch", async ({
    page,
  }) => {
    await page.goto("/docs/web/actions");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("IF", { exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("LOOP", { exact: true })).toBeVisible();
    await expect(page.getByText("SWITCH", { exact: true })).toBeVisible();
    await expect(page.getByText("TRY_CATCH", { exact: true })).toBeVisible();
  });

  test("shows Data actions: Set Variable, Sort, Filter, Map, Reduce", async ({
    page,
  }) => {
    await page.goto("/docs/web/actions");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("SET_VARIABLE", { exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("SORT", { exact: true })).toBeVisible();
    await expect(page.getByText("FILTER", { exact: true })).toBeVisible();
    await expect(page.getByText("MAP", { exact: true })).toBeVisible();
    await expect(page.getByText("REDUCE", { exact: true })).toBeVisible();
  });

  test("shows Code/AI actions: Code Block, AI Prompt", async ({ page }) => {
    await page.goto("/docs/web/actions");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("CODE_BLOCK", { exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("AI_PROMPT", { exact: true })).toBeVisible();
    await expect(page.getByText("SHELL", { exact: true })).toBeVisible();
  });

  test("shows key concept about action categories", async ({ page }) => {
    await page.goto("/docs/web/actions");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("Key Concept: Action Categories")).toBeVisible({
      timeout: 10000,
    });

    await expect(page.getByText(/7 categories/i)).toBeVisible();
  });
});

test.describe("Web AI Actions (/docs/web/ai-actions)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/docs/web/ai-actions");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/docs-web-ai-actions.png",
      fullPage: true,
    });
  });

  test("displays page title", async ({ page }) => {
    await page.goto("/docs/web/ai-actions");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", {
      name: /ai actions/i,
      level: 1,
    });
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("shows AI_PROMPT action documentation", async ({ page }) => {
    await page.goto("/docs/web/ai-actions");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /ai prompt action/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByRole("heading", { name: "AI_PROMPT" })
    ).toBeVisible();
  });

  test("shows configuration options", async ({ page }) => {
    await page.goto("/docs/web/ai-actions");
    await page.waitForLoadState("domcontentloaded");

    // Configuration options for AI_PROMPT
    await expect(page.getByText("prompt", { exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("templateId", { exact: true })).toBeVisible();
    await expect(page.getByText("maxSessions", { exact: true })).toBeVisible();
    await expect(
      page.getByText("outputVariable", { exact: true })
    ).toBeVisible();
  });

  test("shows when to use AI actions", async ({ page }) => {
    await page.goto("/docs/web/ai-actions");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("When to Use AI Actions")).toBeVisible({
      timeout: 10000,
    });

    await expect(
      page.getByText("Autonomous code analysis, fixes, and improvements", {
        exact: true,
      })
    ).toBeVisible();
    await expect(
      page.getByText("Test generation and documentation")
    ).toBeVisible();
  });
});

test.describe("Web Image Recognition (/docs/web/image-recognition)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/docs/web/image-recognition");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/docs-web-image-recognition.png",
      fullPage: true,
    });
  });

  test("displays page title", async ({ page }) => {
    await page.goto("/docs/web/image-recognition");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", {
      name: /image recognition/i,
      level: 1,
    });
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("shows template matching explanation", async ({ page }) => {
    await page.goto("/docs/web/image-recognition");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", {
        name: /how image recognition works/i,
      })
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByText("template matching", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText(/compared pixel-by-pixel using OpenCV/i)
    ).toBeVisible();
  });

  test("shows why visual recognition section", async ({ page }) => {
    await page.goto("/docs/web/image-recognition");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("Why Visual Recognition?")).toBeVisible({
      timeout: 10000,
    });

    await expect(page.getByText(/resolution independent/i)).toBeVisible();
    await expect(page.getByText(/ui framework agnostic/i)).toBeVisible();
    await expect(page.getByText(/resilient to minor changes/i)).toBeVisible();
  });

  test("shows the template matching process steps", async ({ page }) => {
    await page.goto("/docs/web/image-recognition");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("The Template Matching Process")).toBeVisible({
      timeout: 10000,
    });

    await expect(page.getByText(/captures the current screen/i)).toBeVisible();
  });
});

test.describe("Web Keyboard Shortcuts (/docs/web/keyboard-shortcuts)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/docs/web/keyboard-shortcuts");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/docs-web-keyboard-shortcuts.png",
      fullPage: true,
    });
  });

  test("displays page title", async ({ page }) => {
    await page.goto("/docs/web/keyboard-shortcuts");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", {
      name: /keyboard shortcuts/i,
    });
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("shows shortcut reference sections", async ({ page }) => {
    await page.goto("/docs/web/keyboard-shortcuts");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /state machine editor/i })
    ).toBeVisible({ timeout: 10000 });
  });

  test("shows StateImage movement methods", async ({ page }) => {
    await page.goto("/docs/web/keyboard-shortcuts");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("StateImage Operations")).toBeVisible({
      timeout: 10000,
    });

    // Alt+Drag for moving StateImages
    await expect(
      page.getByText(/move a stateimage from one state to another/i)
    ).toBeVisible();
  });

  test("shows modifier keys reference", async ({ page }) => {
    await page.goto("/docs/web/keyboard-shortcuts");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /modifier keys reference/i })
    ).toBeVisible({ timeout: 10000 });

    // Platform-specific modifier keys
    await expect(
      page.getByRole("heading", { name: "Windows" })
    ).toBeVisible();
  });

  test("shows canvas navigation shortcuts", async ({ page }) => {
    await page.goto("/docs/web/keyboard-shortcuts");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("Canvas Navigation")).toBeVisible({
      timeout: 10000,
    });

    await expect(page.getByText("Zoom in/out on the canvas")).toBeVisible();
  });
});

test.describe("Web States (/docs/web/states)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/docs/web/states");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/docs-web-states.png",
      fullPage: true,
    });
  });

  test("displays page title", async ({ page }) => {
    await page.goto("/docs/web/states");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", {
      name: /working with states/i,
    });
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("shows state concept explanation", async ({ page }) => {
    await page.goto("/docs/web/states");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /what is a state/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByText(/represents a distinct screen, dialog, or condition/i)
    ).toBeVisible();
  });

  test("shows visual identification key concept", async ({ page }) => {
    await page.goto("/docs/web/states");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByText("Key Concept: Visual Identification")
    ).toBeVisible({ timeout: 10000 });
  });

  test("shows creating states steps", async ({ page }) => {
    await page.goto("/docs/web/states");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /creating a state/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("Add a New State")).toBeVisible();
    await expect(page.getByText("Name Your State")).toBeVisible();
    await expect(page.getByText("Add a Description")).toBeVisible();
    await expect(page.getByText("Upload Identifying Images")).toBeVisible();
  });

  test("shows state properties: is_initial and is_final", async ({ page }) => {
    await page.goto("/docs/web/states");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /state properties/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByRole("heading", { name: "Initial State" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Final State" })
    ).toBeVisible();

    // Descriptions mention is_initial and is_final behaviors
    await expect(
      page.getByText(/mark one or more states as initial/i)
    ).toBeVisible();
    await expect(
      page.getByText(/mark states where automation should stop/i)
    ).toBeVisible();
  });

  test("shows identifying images section", async ({ page }) => {
    await page.goto("/docs/web/states");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: "Identifying Images", exact: true })
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByRole("heading", { name: "Similarity Threshold" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Required" })
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Shared" })).toBeVisible();
  });

  test("shows parallel states concept", async ({ page }) => {
    await page.goto("/docs/web/states");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("Parallel States")).toBeVisible({
      timeout: 10000,
    });

    await expect(
      page.getByText(/multiple states can be active simultaneously/i)
    ).toBeVisible();
  });

  test("shows state examples", async ({ page }) => {
    await page.goto("/docs/web/states");
    await page.waitForLoadState("domcontentloaded");

    // Anchor on the "Examples of States:" list to scope the matches — the
    // page also has "Dashboard" in nav (header) and "Final State"/"Dashboard"
    // mentions elsewhere; the example list contains the <strong> labels.
    const examplesList = page
      .getByRole("heading", { name: "Examples of States:" })
      .locator("..")
      .getByRole("list");
    await expect(examplesList.getByText("Login Screen")).toBeVisible({
      timeout: 10000,
    });
    await expect(examplesList.getByText("Dashboard")).toBeVisible();
    await expect(examplesList.getByText("Error Dialog")).toBeVisible();
  });
});

test.describe("Web Transitions (/docs/web/transitions)", () => {
  test("loads without 500 error", async ({ page }) => {
    await page.goto("/docs/web/transitions");
    await page.waitForLoadState("domcontentloaded");

    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");

    await page.screenshot({
      path: "test-results/docs-web-transitions.png",
      fullPage: true,
    });
  });

  test("displays page title", async ({ page }) => {
    await page.goto("/docs/web/transitions");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", {
      name: /state transitions/i,
    });
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("shows transition concept explanation", async ({ page }) => {
    await page.goto("/docs/web/transitions");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /what is a transition/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByText(
        /connection between two states that defines how automation moves/i
      )
    ).toBeVisible();
  });

  test("shows two transition types: Outgoing and Incoming", async ({
    page,
  }) => {
    await page.goto("/docs/web/transitions");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /types of transitions/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByRole("heading", { name: "Outgoing Transition", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Incoming Transition", exact: true })
    ).toBeVisible();

    // Details of each type
    await expect(
      page.getByText(/defines navigation from one state to another/i)
    ).toBeVisible();
    await expect(
      page.getByText(/verification or setup when entering a state/i)
    ).toBeVisible();
  });

  test("shows transition properties", async ({ page }) => {
    await page.goto("/docs/web/transitions");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /transition properties/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByRole("heading", { name: "from_state" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "to_state" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "stays_visible", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "activate_states", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "deactivate_states", exact: true })
    ).toBeVisible();
  });

  test("shows parallel state management section", async ({ page }) => {
    await page.goto("/docs/web/transitions");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", {
        name: /managing parallel states/i,
      })
    ).toBeVisible({ timeout: 10000 });

    // Scenario examples
    await expect(
      page.getByText("Scenario 1: Dialog Over Background")
    ).toBeVisible();
    await expect(
      page.getByText("Scenario 2: Multi-State Activation")
    ).toBeVisible();
    await expect(
      page.getByText("Scenario 3: Closing Parallel States")
    ).toBeVisible();
  });

  test("shows creating a transition steps", async ({ page }) => {
    await page.goto("/docs/web/transitions");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /creating a transition/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByText("Select Source and Destination States")
    ).toBeVisible();
    await expect(page.getByText("Configure the Transition")).toBeVisible();
    await expect(page.getByText("Assign a Process")).toBeVisible();
    await expect(page.getByText("Set State Visibility Options")).toBeVisible();
  });

  test("shows best practices", async ({ page }) => {
    await page.goto("/docs/web/transitions");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByRole("heading", { name: /best practices/i })
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByText("Name transitions descriptively")
    ).toBeVisible();
    await expect(
      page.getByText("Use Incoming Transitions for verification")
    ).toBeVisible();
    await expect(
      page.getByText("Use stays_visible for overlays")
    ).toBeVisible();
  });

  test("shows how transitions work steps", async ({ page }) => {
    await page.goto("/docs/web/transitions");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("How Transitions Work")).toBeVisible({
      timeout: 10000,
    });

    await expect(
      page.getByText(/automation is in the source state/i)
    ).toBeVisible();
    await expect(
      page.getByText(/destination state becomes active/i)
    ).toBeVisible();
  });

  test("has key concept about transitions equaling navigation logic", async ({
    page,
  }) => {
    await page.goto("/docs/web/transitions");
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByText("Key Concept: Transitions = Navigation Logic")
    ).toBeVisible({ timeout: 10000 });
  });
});
