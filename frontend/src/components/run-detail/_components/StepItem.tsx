import type { Checkpoint } from "@/lib/runner-api";
import {
  formatDuration,
  getStepTypeIcon,
  parseStepData,
} from "../_utils/timeline-utils";
import { StatusIcon } from "./StatusIcon";
import { InlineProgressBar } from "./InlineProgressBar";

export function StepItem({ step }: { step: Checkpoint }) {
  const parsed = parseStepData(step);

  const {
    icon: StepIcon,
    bg: iconBg,
    text: iconText,
  } = getStepTypeIcon(step.step_type, parsed.iconType);

  const displaySummary = parsed.workSummary || parsed.summary || null;
  const error = step.error || parsed.error || null;
  const showError = error && error !== displaySummary;

  const displayName = step.step_name || step.step_type;

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-canvas/30 transition-colors">
      <StatusIcon status={step.status} />

      <div className={`p-1 rounded ${iconBg}`}>
        <StepIcon className={`size-3 ${iconText}`} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-text-primary truncate">
            {displayName}
          </span>
          {step.duration_ms != null && (
            <span className="text-xs text-text-muted">
              ({formatDuration(step.duration_ms)})
            </span>
          )}
          {parsed.progress && parsed.progress.total !== null && (
            <InlineProgressBar
              current={parsed.progress.current}
              total={parsed.progress.total}
              progressType={parsed.progress.type}
            />
          )}
        </div>
        {displaySummary && (
          <p className="text-xs text-text-muted truncate mt-0.5">
            {displaySummary}
          </p>
        )}
        {parsed.progress?.description && (
          <p className="text-xs text-text-muted truncate mt-0.5">
            {parsed.progress.description}
          </p>
        )}
        {showError && (
          <p className="text-xs text-red-400 truncate mt-0.5">{error}</p>
        )}
      </div>
    </div>
  );
}
