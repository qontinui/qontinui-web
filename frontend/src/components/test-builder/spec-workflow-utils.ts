import type {
  AnalyzedElement,
  SpecStepType,
  SpecStep,
} from "./spec-workflow-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function createId(): string {
  return `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDefaultStep(type: SpecStepType): SpecStep {
  const id = createId();
  switch (type) {
    case "navigate":
      return { id, type, name: "Navigate", url: "" };
    case "interact":
      return {
        id,
        type,
        name: "Interact",
        elementId: null,
        action: "click",
      };
    case "assert":
      return {
        id,
        type,
        name: "Assert",
        elementId: null,
        assertion: "visible",
      };
    case "wait":
      return {
        id,
        type,
        name: "Wait",
        condition: "time",
        timeoutMs: 1000,
      };
    case "screenshot":
      return {
        id,
        type,
        name: "Screenshot",
        label: "screenshot",
        fullPage: false,
      };
  }
}

export function resolveSelector(
  elementId: string | null | undefined,
  elements: AnalyzedElement[]
): string {
  if (!elementId) return "'[no element selected]'";
  const el = elements.find((e) => e.id === elementId);
  if (!el) return `'[unknown element ${elementId}]'`;
  if (el.selector) return `'${el.selector}'`;
  // Fall back to a descriptive locator
  const tag = el.tagName.toLowerCase();
  if (el.text) return `page.getByRole('${tag}', { name: '${el.text}' })`;
  return `'${tag}#${el.id}'`;
}

export function generatePlaywrightCode(
  steps: SpecStep[],
  elements: AnalyzedElement[]
): string {
  const lines: string[] = [
    `import { test, expect } from "@playwright/test";`,
    ``,
    `test("generated spec test", async ({ page }) => {`,
  ];

  for (const step of steps) {
    lines.push(`  // ${step.name}`);
    switch (step.type) {
      case "navigate":
        lines.push(`  await page.goto('${step.url}');`);
        break;
      case "interact": {
        const sel = resolveSelector(step.elementId, elements);
        switch (step.action) {
          case "click":
            lines.push(`  await page.locator(${sel}).click();`);
            break;
          case "type":
            lines.push(
              `  await page.locator(${sel}).fill('${step.value ?? ""}');`
            );
            break;
          case "hover":
            lines.push(`  await page.locator(${sel}).hover();`);
            break;
          case "focus":
            lines.push(`  await page.locator(${sel}).focus();`);
            break;
          case "clear":
            lines.push(`  await page.locator(${sel}).fill('');`);
            break;
        }
        break;
      }
      case "assert": {
        const sel = resolveSelector(step.elementId, elements);
        switch (step.assertion) {
          case "visible":
            lines.push(`  await expect(page.locator(${sel})).toBeVisible();`);
            break;
          case "hidden":
            lines.push(`  await expect(page.locator(${sel})).toBeHidden();`);
            break;
          case "text_equals":
            lines.push(
              `  await expect(page.locator(${sel})).toHaveText('${step.expected ?? ""}');`
            );
            break;
          case "text_contains":
            lines.push(
              `  await expect(page.locator(${sel})).toContainText('${step.expected ?? ""}');`
            );
            break;
          case "has_attribute":
            lines.push(
              `  await expect(page.locator(${sel})).toHaveAttribute('${step.attributeName ?? ""}', '${step.expected ?? ""}');`
            );
            break;
          case "is_enabled":
            lines.push(`  await expect(page.locator(${sel})).toBeEnabled();`);
            break;
          case "is_disabled":
            lines.push(`  await expect(page.locator(${sel})).toBeDisabled();`);
            break;
          case "exists":
            lines.push(`  await expect(page.locator(${sel})).toHaveCount(1);`);
            break;
        }
        break;
      }
      case "wait":
        switch (step.condition) {
          case "time":
            lines.push(`  await page.waitForTimeout(${step.timeoutMs});`);
            break;
          case "element_visible": {
            const sel = resolveSelector(step.elementId, elements);
            lines.push(
              `  await page.locator(${sel}).waitFor({ state: 'visible', timeout: ${step.timeoutMs} });`
            );
            break;
          }
          case "element_hidden": {
            const sel = resolveSelector(step.elementId, elements);
            lines.push(
              `  await page.locator(${sel}).waitFor({ state: 'hidden', timeout: ${step.timeoutMs} });`
            );
            break;
          }
          case "url_contains":
            lines.push(
              `  await page.waitForURL('**/*${step.value ?? ""}*', { timeout: ${step.timeoutMs} });`
            );
            break;
        }
        break;
      case "screenshot":
        if (step.fullPage) {
          lines.push(
            `  await page.screenshot({ path: '${step.label}.png', fullPage: true });`
          );
        } else {
          lines.push(`  await page.screenshot({ path: '${step.label}.png' });`);
        }
        break;
    }
    lines.push(``);
  }

  lines.push(`});`);
  return lines.join("\n");
}
