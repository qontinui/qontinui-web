import { TEST_TEMPLATES } from "./test-config";

/** Check if the current code is empty or matches any template (possibly with URL substitution) */
export function isCodeEmptyOrTemplate(code: string): boolean {
  if (!code.trim()) return true;
  const trimmed = code.trim();
  for (const template of Object.values(TEST_TEMPLATES)) {
    // Check against the raw template and any URL-substituted variant
    const rawTrimmed = template.trim();
    if (trimmed === rawTrimmed) return true;
    // Also check if it's a template with {{url}} replaced by something
    const escaped = rawTrimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = escaped.replace("\\{\\{url\\}\\}", ".*");
    if (new RegExp(`^${pattern}$`, "s").test(trimmed)) return true;
  }
  return false;
}

/** Get Monaco editor language for a test type */
export function getLanguageForTestType(testType: string): string {
  switch (testType) {
    case "python_script": return "python";
    case "qontinui_vision": return "python";
    case "repository_test": return "shell";
    default: return "python";
  }
}
