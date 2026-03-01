/**
 * Shared types for TestCaseEditor and its sub-components/hooks.
 */

export interface ValidationErrors {
  name?: string;
  assertions?: string;
  [key: string]: string | undefined;
}

export interface ExpandedSections {
  input: boolean;
  expected: boolean;
  assertions: boolean;
  advanced: boolean;
}
