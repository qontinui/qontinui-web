import type {
  Action,
  StateType,
  WorkflowType,
  ImageType,
} from "../action-editor-types";
import { getActionSummary } from "../action-summary-utils";

interface ActionSummaryProps {
  action: Action;
  states: StateType[];
  workflows: WorkflowType[];
  images: ImageType[];
}

export function ActionSummary({
  action,
  states,
  workflows,
  images,
}: ActionSummaryProps) {
  const summary = getActionSummary(action, states, workflows, images);
  const hasRemovedImage = summary.includes("[REMOVED:");

  if (hasRemovedImage) {
    // Parse the summary to highlight removed image parts in red
    const parts = summary.split(/(\[REMOVED:[^\]]+\])/);
    return (
      <p className="text-xs mt-1">
        {parts.map((part, index) => {
          if (part.startsWith("[REMOVED:")) {
            return (
              <span key={index} className="text-red-400 font-medium">
                {part}
              </span>
            );
          }
          return (
            <span key={index} className="text-text-muted">
              {part}
            </span>
          );
        })}
      </p>
    );
  }

  return <p className="text-xs text-text-muted mt-1">{summary}</p>;
}
