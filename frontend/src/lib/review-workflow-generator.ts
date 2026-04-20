import type {
  UnifiedWorkflow,
  SetupStep,
  AgenticStep,
  VerificationStep,
  CompletionStep,
} from "@/types/unified-workflow";

export interface ReviewWorkflowConfig {
  targetUrl: string;
  pages: { url: string; title: string; enabled: boolean }[];
  interactionDepth: 1 | 2 | 3;
  fixErrors: boolean;
  maxFixIterations: number;
  severityThreshold: "error" | "warning" | "info";
  checkContent: boolean;
  checkAccessibility: boolean;
  checkVisual: boolean;
  checkSemantic: boolean;
  workflowName: string;
  workflowDescription: string;
}

const DEPTH_LABELS: Record<number, string> = {
  1: "links only",
  2: "links + buttons/forms",
  3: "full interaction (dropdowns, modals, drag-and-drop)",
};

function buildContentCheckInstructions(): string {
  return `Content Validation Checks:
- ERROR if element text contains literal "NaN", "undefined", "null", or "[object Object]"
- WARNING for empty headings (<h1>-<h6> with no text)
- WARNING for empty labels (<label> with no text)
- WARNING for empty buttons (<button> with no text and no aria-label)
- WARNING for invalid links (href="#" or empty href)
- ERROR for broken images (<img> where naturalWidth === 0)`;
}

function buildAccessibilityCheckInstructions(): string {
  return `Accessibility Checks:
- ERROR for inputs/selects/textareas without associated label or aria-label
- ERROR for images without alt attribute
- WARNING for skipped heading levels (h1 -> h3) or out-of-order heading sizes
- WARNING for icon-only buttons (contains only SVG/img with no aria-label)
- INFO for pages missing <main>, <nav>, or ARIA landmark roles`;
}

function buildVisualCheckInstructions(): string {
  return `Visual Analysis:
- Run the \`auditPage\` extension command on each page
- Check for layout issues, color contrast problems, and broken images
- Report any visual anomalies or rendering problems`;
}

function buildSemanticCheckInstructions(): string {
  return `Semantic Inspection:
- Call \`getSpecs\` via the extension to retrieve page spec configurations
- For each spec group, verify assertions against the current page state
- Check element presence, text content, visibility, and enabled state
- Report spec assertion failures as findings`;
}

function buildFixInstructions(maxIterations: number): string {
  return `Fix Cycle (ENABLED - max ${maxIterations} attempts per issue):
1. Read source code to identify root cause file and line
2. Implement minimal, targeted code fix
3. Restart the service using: dev-start.ps1 -Frontend or -Backend
4. Wait 10 seconds for startup
5. Re-navigate and validate the fix resolved the issue
- If fix succeeds: mark finding as fixed
- If fix fails after ${maxIterations} attempts: mark finding as unfixable, move to next`;
}

function buildAgenticPrompt(config: ReviewWorkflowConfig): string {
  const enabledPages = config.pages.filter((p) => p.enabled);

  const pageList = enabledPages
    .map((p, i) => `  ${i + 1}. ${p.title} — ${config.targetUrl}${p.url}`)
    .join("\n");

  const checks: string[] = [];
  if (config.checkContent) checks.push(buildContentCheckInstructions());
  if (config.checkAccessibility)
    checks.push(buildAccessibilityCheckInstructions());
  if (config.checkVisual) checks.push(buildVisualCheckInstructions());
  if (config.checkSemantic) checks.push(buildSemanticCheckInstructions());

  const checksSection = checks.join("\n\n");

  const fixSection = config.fixErrors
    ? buildFixInstructions(config.maxFixIterations)
    : "Fix Mode: DISABLED — report issues only, do not modify code.";

  return `You are performing an autonomous UI review of a web application via the Chrome extension (UI Bridge external mode).

## Target Application
URL: ${config.targetUrl}

## Pages to Review (${enabledPages.length} total)
${pageList}

## Interaction Depth: ${config.interactionDepth} (${DEPTH_LABELS[config.interactionDepth]})

## Checks to Perform
${checksSection}

## Severity Threshold: ${config.severityThreshold}
Only report findings at "${config.severityThreshold}" level or higher.

## ${fixSection}

## Process for Each Page

1. **Navigate** to the page URL using the extension
2. **Discover elements** using \`getElements\` command
3. **Run enabled checks** against the discovered elements
4. **Check dev logs** for new errors (read .dev-logs/frontend.err.log and .dev-logs/backend.err.log)
5. **Emit findings** using the format: [FINDING:type:severity:tag] description
   - type: content_error | accessibility | visual | interaction | semantic | runtime_error
   - severity: error | warning | info
   - tag: short identifier (e.g., nan_display, missing_label, broken_image)
6. ${config.fixErrors ? "**Attempt fixes** for each finding following the Fix Cycle above" : "**Move to next page**"}

## Finding Format Examples
[FINDING:content_error:error:nan_display] Dashboard page displays "NaN" in the revenue widget
[FINDING:accessibility:error:missing_label] Login form email input has no associated label
[FINDING:visual:warning:layout_shift] Sidebar overlaps main content on the settings page
[FINDING:runtime_error:error:console_error] TypeError: Cannot read property 'map' of undefined on /dashboard

## Important Notes
- Navigate pages sequentially (extension operates on one tab)
- Take note of error log baseline at start to distinguish new vs pre-existing errors
- After completing all pages, output [TASK_COMPLETE]`;
}

export function generateReviewWorkflow(
  config: ReviewWorkflowConfig
): Partial<UnifiedWorkflow> {
  const enabledPages = config.pages.filter((p) => p.enabled);

  // Setup steps
  const setupSteps: Record<string, unknown>[] = [
    {
      type: "ApiRequest",
      name: "Check extension connection",
      description: "Verify Chrome extension is connected and responsive",
      endpoint: "/extension/status",
      method: "GET",
      expect_status: 200,
      expect_body: { connected: true },
    },
    {
      type: "ApiRequest",
      name: "Verify page access",
      description: `Discover navigation elements on ${config.targetUrl}`,
      endpoint: "/extension/command",
      method: "POST",
      body: {
        action: "getElements",
        params: { includeNonInteractive: false },
      },
    },
    {
      type: "ShellCommand",
      name: "Snapshot error baseline",
      description:
        "Record current error log sizes to detect new errors during review",
      command:
        'powershell -Command "Get-Item .dev-logs/frontend.err.log, .dev-logs/backend.err.log -ErrorAction SilentlyContinue | Select-Object Name, Length | ConvertTo-Json"',
    },
  ];

  // Agentic steps - single AI session with the review prompt
  const agenticSteps: Record<string, unknown>[] = [
    {
      type: "AiSession",
      name: `Review ${enabledPages.length} pages`,
      description: `Autonomous UI review of ${config.targetUrl} across ${enabledPages.length} pages`,
      prompt: buildAgenticPrompt(config),
      append_finding_instructions: true,
    },
  ];

  // Verification steps
  const verificationSteps: Record<string, unknown>[] = [
    {
      type: "ApiRequest",
      name: "Health check target",
      description: `Verify ${config.targetUrl} is still responsive`,
      endpoint: config.targetUrl,
      method: "GET",
      expect_status: 200,
    },
    {
      type: "LogWatch",
      name: "Check for new errors",
      description:
        "Watch frontend and backend error logs for errors introduced during review",
      log_files: [".dev-logs/frontend.err.log", ".dev-logs/backend.err.log"],
      pattern: "error|Error|ERROR|Traceback|TypeError|ReferenceError",
    },
  ];

  // Completion steps
  const completionSteps: Record<string, unknown>[] = [
    {
      type: "Prompt",
      name: "Generate review summary",
      description:
        "AI generates a summary of all findings, fixes applied, and remaining issues",
      prompt: `Generate a comprehensive summary of the UI review for ${config.targetUrl}. Include:
- Total pages reviewed: ${enabledPages.length}
- Checks performed: ${[config.checkContent && "content", config.checkAccessibility && "accessibility", config.checkVisual && "visual", config.checkSemantic && "semantic"].filter(Boolean).join(", ")}
- Interaction depth: ${config.interactionDepth} (${DEPTH_LABELS[config.interactionDepth]})
- Fix mode: ${config.fixErrors ? "enabled" : "disabled"}
- Summary of findings by severity
- List of fixes applied (if any)
- Remaining unfixed issues`,
    },
  ];

  return {
    name: config.workflowName,
    description: config.workflowDescription,
    setupSteps: setupSteps as unknown as SetupStep[],
    agenticSteps: agenticSteps as unknown as AgenticStep[],
    verificationSteps: verificationSteps as unknown as VerificationStep[],
    completionSteps: completionSteps as unknown as CompletionStep[],
  };
}
