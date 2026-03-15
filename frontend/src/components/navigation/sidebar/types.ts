import type React from "react";

export interface NavItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  route: string;
  color: string;
  children?: NavItem[];
  badge?: "beta" | "experimental";
  adminOnly?: boolean;
  hiddenInProd?: boolean;
  /** Product mode visibility - "ai", "visual", or "both" (default: shown in all modes) */
  productMode?: "ai" | "visual" | "both";
  /** When set on the first item in a group, renders a section label above it. */
  group?: string;
}
