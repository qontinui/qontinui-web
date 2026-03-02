export const RUNNER_API_BASE = "http://localhost:9876";

export interface AccessibilityNode {
  role: string;
  name?: string;
  value?: string;
  description?: string;
  ref?: string;
  is_interactive?: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
  state?: Record<string, boolean>;
  properties?: Record<string, unknown>;
  children?: AccessibilityNode[];
  [key: string]: unknown;
}
