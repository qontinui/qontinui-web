"use client";

import { useState } from "react";

/**
 * Manages controlled/uncontrolled expansion state for a step card.
 *
 * When `onToggle` is provided, the component is controlled externally.
 * Otherwise, it manages its own local expansion state.
 */
export function useStepExpansion(isExpanded: boolean, onToggle?: () => void) {
  const [localExpanded, setLocalExpanded] = useState(isExpanded);
  const expanded = onToggle ? isExpanded : localExpanded;
  const toggle = onToggle ?? (() => setLocalExpanded(!localExpanded));

  return { expanded, toggle };
}
