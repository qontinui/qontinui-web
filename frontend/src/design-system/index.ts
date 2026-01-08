/**
 * Qontinui Design System
 *
 * Central export for design tokens, components, and utilities.
 *
 * Usage:
 *   import { colors, typography, spacing } from "@/design-system";
 *   import { brand, surface } from "@/design-system/tokens";
 *   import { PageLayout, CanvasLayout, ScrollContainer } from "@/design-system";
 */

// Token exports
export * from "./tokens";

// Component exports
export * from "./components";

// Type exports
export type {
  Colors,
  BrandColors,
  SurfaceColors,
  BorderColors,
  TextColors,
  SemanticColors,
  ChartColors,
  GlowColors,
} from "./tokens/colors";

export type {
  Typography,
  FontFamily,
  FontSize,
  FontWeight,
  LineHeight,
  LetterSpacing,
  TextStyles,
} from "./tokens/typography";

export type {
  Spacing,
  Space,
  SemanticSpace,
  ComponentSize,
  Layout,
  Radius,
} from "./tokens/spacing";
