import type {
  AccessibilityNode,
  AccessibilitySelector,
} from "@qontinui/schemas/accessibility";

export interface AccessibilityExplorerProps {
  /** Callback when a selector is configured for use in automation */
  onSelectorConfigured?: (
    selector: AccessibilitySelector,
    node: AccessibilityNode
  ) => void;
  /** Initial CDP host */
  initialCdpHost?: string;
  /** Initial CDP port */
  initialCdpPort?: number;
  /** Runner API URL */
  apiUrl?: string;
  /** Show connection settings */
  showSettings?: boolean;
  /** Additional class names */
  className?: string;
}
