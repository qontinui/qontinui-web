/**
 * AddActionButton - inline divider button for inserting a new action
 * between existing actions in the sequential list.
 */

import type { AddActionButtonProps } from "../types";

export function AddActionButton({ onClick, visible }: AddActionButtonProps) {
  return (
    <div className={`add-action-divider ${visible ? "visible" : ""}`}>
      <button className="add-action-inline-button" onClick={onClick}>
        + Add Action
      </button>
    </div>
  );
}
