import type {
  UnifiedStep,
  CommandStep,
  UiBridgeStep,
  PromptStep,
} from "@/types/unified-workflow";

export interface StepValidationIssue {
  field: string;
  message: string;
  severity: "warning" | "error";
}

export function getStepValidationIssues(
  step: UnifiedStep
): StepValidationIssue[] {
  const issues: StepValidationIssue[] = [];

  switch (step.type) {
    case "command": {
      const cmd = step as CommandStep;
      if (
        !cmd.command &&
        !cmd.test_type &&
        !cmd.check_type &&
        !cmd.check_group_id &&
        !cmd.test_id
      ) {
        issues.push({
          field: "command",
          message: "No command specified",
          severity: "error",
        });
      }
      if (
        cmd.test_type === "playwright" &&
        !cmd.script_id &&
        !cmd.code &&
        !cmd.script_content
      ) {
        issues.push({
          field: "script",
          message: "No test script",
          severity: "warning",
        });
      }
      break;
    }
    case "ui_bridge": {
      const ub = step as UiBridgeStep;
      if (ub.action === "navigate" && !ub.url) {
        issues.push({
          field: "url",
          message: "URL required",
          severity: "error",
        });
      }
      if (ub.action === "assert" && !ub.target) {
        issues.push({
          field: "target",
          message: "Target element required",
          severity: "error",
        });
      }
      if (ub.action === "execute" && !ub.instruction) {
        issues.push({
          field: "instruction",
          message: "Instruction required",
          severity: "error",
        });
      }
      break;
    }
    case "prompt": {
      const prompt = step as PromptStep;
      if (!prompt.content) {
        issues.push({
          field: "content",
          message: "Empty prompt",
          severity: "warning",
        });
      }
      break;
    }
  }

  return issues;
}
