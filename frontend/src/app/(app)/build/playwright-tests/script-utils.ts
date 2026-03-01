import type { PlaywrightScript } from "@/lib/runner/types/library";

export type ViewMode = "description" | "code";

export interface ScriptForm {
  name: string;
  description: string;
  script_content: string;
  target_url: string;
  ai_instructions: string;
  category: string;
  tags: string[];
  timeout_seconds: number;
  display_mode: string;
  browser: string;
  screenshot_on_failure: boolean;
  trace_enabled: boolean;
  video_enabled: boolean;
}

export const DEFAULT_SCRIPT_CONTENT = `import { test, expect } from '@playwright/test';

test('example test', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page).toHaveTitle(/Example/);
});
`;

export function toForm(item: PlaywrightScript): ScriptForm {
  return {
    name: item.name ?? "",
    description: item.description ?? "",
    script_content: item.script_content ?? DEFAULT_SCRIPT_CONTENT,
    target_url: item.target_url ?? "",
    ai_instructions: item.ai_instructions ?? "",
    category: item.category ?? "",
    tags: item.tags ?? [],
    timeout_seconds: item.timeout_seconds ?? 30,
    display_mode: item.display_mode ?? "headless",
    browser: item.browser ?? "chromium",
    screenshot_on_failure: true,
    trace_enabled: false,
    video_enabled: false,
  };
}

export function defaultForm(): ScriptForm {
  return {
    name: "",
    description: "",
    script_content: DEFAULT_SCRIPT_CONTENT,
    target_url: "",
    ai_instructions: "",
    category: "",
    tags: [],
    timeout_seconds: 30,
    display_mode: "headless",
    browser: "chromium",
    screenshot_on_failure: true,
    trace_enabled: false,
    video_enabled: false,
  };
}

export function toPayload(form: ScriptForm): Record<string, unknown> {
  return {
    name: form.name,
    description: form.description || undefined,
    script_content: form.script_content,
    target_url: form.target_url || undefined,
    ai_instructions: form.ai_instructions || undefined,
    category: form.category || undefined,
    tags: form.tags.length > 0 ? form.tags : undefined,
    timeout_seconds: form.timeout_seconds,
    display_mode: form.display_mode,
    browser: form.browser,
  };
}

const DRAFT_KEY_PREFIX = "script-draft-";

function getDraftKey(id: string | undefined): string {
  return `${DRAFT_KEY_PREFIX}${id ?? "new"}`;
}

export function saveDraft(id: string | undefined, form: ScriptForm): void {
  try {
    localStorage.setItem(getDraftKey(id), JSON.stringify(form));
  } catch {
    // localStorage full or unavailable
  }
}

export function loadDraft(id: string | undefined): ScriptForm | null {
  try {
    const raw = localStorage.getItem(getDraftKey(id));
    if (raw) return JSON.parse(raw) as ScriptForm;
  } catch {
    // parse error
  }
  return null;
}

export function clearDraft(id: string | undefined): void {
  try {
    localStorage.removeItem(getDraftKey(id));
  } catch {
    // ignore
  }
}
