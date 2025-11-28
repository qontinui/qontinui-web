"use client";

/**
 * State Discovery Page (Beta)
 *
 * Automatically discover states from screenshots and user interactions.
 * Allows users to:
 * - Upload sequences of screenshots representing different application states
 * - Automatically identify unique states based on visual differences
 * - Detect state transitions from screenshot sequences
 * - Generate state structures automatically
 * - Review and refine discovered states
 * - Configure discovery sensitivity and parameters
 * - Export discovered states to the state editor
 */

import StateDiscoveryTab from "@/components/state-discovery/StateDiscoveryTab";
import { RequireProject } from "@/components/require-project";

export default function StateDiscoveryPage() {
  return (
    <RequireProject pageName="State Discovery">
      <StateDiscoveryTab />
    </RequireProject>
  );
}
