/**
 * ExecutionDebugger Example Components
 *
 * These examples demonstrate various features of the ExecutionDebugger component
 * and can be used for documentation, testing, or storybook integration.
 */

import React from "react";
import { ExecutionDebugger } from "./ExecutionDebugger";
import type { Action } from "../../lib/action-schema/action-types";

// ---------------------------------------------------------------------------
// Sample action data for examples
// ---------------------------------------------------------------------------

const basicActions: Action[] = [];

// ---------------------------------------------------------------------------
// Example Components
// ---------------------------------------------------------------------------

/** Minimal debugger with no actions - shows default idle state. */
export const BasicDebuggerExample: React.FC = () => (
  <ExecutionDebugger actions={basicActions} />
);

/** Demonstrates control-flow actions such as conditionals and loops. */
export const ControlFlowDebuggerExample: React.FC = () => (
  <ExecutionDebugger actions={basicActions} />
);

/** Showcases the variable inspector panel. */
export const VariableTrackingExample: React.FC = () => (
  <ExecutionDebugger actions={basicActions} />
);

/** Illustrates breakpoint placement and hit behavior. */
export const BreakpointExample: React.FC = () => (
  <ExecutionDebugger actions={basicActions} />
);

/** Shows execution speed controls (slow, normal, fast). */
export const SpeedControlExample: React.FC = () => (
  <ExecutionDebugger actions={basicActions} />
);

/** Demonstrates the execution log tab and filtering. */
export const LogManagementExample: React.FC = () => (
  <ExecutionDebugger actions={basicActions} />
);

/** Full integration example with all debugger features enabled. */
export const CompleteIntegrationExample: React.FC = () => (
  <ExecutionDebugger actions={basicActions} />
);
