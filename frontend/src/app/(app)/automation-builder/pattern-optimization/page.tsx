"use client";

/**
 * Pattern Extraction Page
 *
 * Extract robust image patterns from multiple screenshots by identifying
 * stable vs variable pixels. Creates masked templates that ignore dynamic
 * content (text, timestamps, counts) for reliable UI automation matching.
 *
 * Workflow:
 * - Upload 2+ screenshots of the same UI element with different content
 * - Select the region containing the element
 * - Configure similarity threshold and mask cleaning options
 * - Extract pattern with transparent areas for variable pixels
 * - Create StateImage for use in automation
 */

import { PatternOptimizationSimplified } from "@/components/pattern-optimization/PatternOptimizationSimplified";
import { RequireProject } from "@/components/require-project";

export default function PatternOptimizationPage() {
  return (
    <RequireProject pageName="Pattern Extraction">
      <PatternOptimizationSimplified />
    </RequireProject>
  );
}
