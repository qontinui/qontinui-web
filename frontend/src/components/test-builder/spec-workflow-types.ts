import type React from "react";
import {
  Navigation,
  MousePointerClick,
  ShieldCheck,
  Timer,
  Camera,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Element discovered by the page analyzer */
export interface AnalyzedElement {
  id: string;
  label: string;
  tagName: string;
  type: string;
  text?: string;
  selector?: string;
  visible: boolean;
  enabled: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  attributes?: Record<string, unknown>;
}

/** The five step types a user can create */
export type SpecStepType =
  | "navigate"
  | "interact"
  | "assert"
  | "wait"
  | "screenshot";

/** Interaction verbs */
export type InteractionAction = "click" | "type" | "hover" | "focus" | "clear";

/** Assertion operators */
export type AssertionKind =
  | "visible"
  | "hidden"
  | "text_equals"
  | "text_contains"
  | "has_attribute"
  | "is_enabled"
  | "is_disabled"
  | "exists";

/** Wait conditions */
export type WaitCondition =
  | "time"
  | "element_visible"
  | "element_hidden"
  | "url_contains";

/** Base fields shared by every step */
interface BaseSpecStep {
  id: string;
  name: string;
  type: SpecStepType;
}

export interface NavigateStep extends BaseSpecStep {
  type: "navigate";
  url: string;
}

export interface InteractStep extends BaseSpecStep {
  type: "interact";
  elementId: string | null;
  action: InteractionAction;
  value?: string;
}

export interface AssertStep extends BaseSpecStep {
  type: "assert";
  elementId: string | null;
  assertion: AssertionKind;
  expected?: string;
  attributeName?: string;
}

export interface WaitStep extends BaseSpecStep {
  type: "wait";
  condition: WaitCondition;
  timeoutMs: number;
  value?: string;
  elementId?: string | null;
}

export interface ScreenshotStep extends BaseSpecStep {
  type: "screenshot";
  label: string;
  fullPage: boolean;
}

export type SpecStep =
  | NavigateStep
  | InteractStep
  | AssertStep
  | WaitStep
  | ScreenshotStep;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const STEP_TYPE_META: Record<
  SpecStepType,
  { label: string; icon: React.ElementType; color: string }
> = {
  navigate: { label: "Navigate", icon: Navigation, color: "text-blue-400" },
  interact: {
    label: "Interact",
    icon: MousePointerClick,
    color: "text-amber-400",
  },
  assert: { label: "Assert", icon: ShieldCheck, color: "text-emerald-400" },
  wait: { label: "Wait", icon: Timer, color: "text-purple-400" },
  screenshot: { label: "Screenshot", icon: Camera, color: "text-pink-400" },
};

export const INTERACTION_ACTIONS: {
  value: InteractionAction;
  label: string;
}[] = [
  { value: "click", label: "Click" },
  { value: "type", label: "Type text" },
  { value: "hover", label: "Hover" },
  { value: "focus", label: "Focus" },
  { value: "clear", label: "Clear" },
];

export const ASSERTION_KINDS: { value: AssertionKind; label: string }[] = [
  { value: "visible", label: "Is visible" },
  { value: "hidden", label: "Is hidden" },
  { value: "text_equals", label: "Text equals" },
  { value: "text_contains", label: "Text contains" },
  { value: "has_attribute", label: "Has attribute" },
  { value: "is_enabled", label: "Is enabled" },
  { value: "is_disabled", label: "Is disabled" },
  { value: "exists", label: "Exists in DOM" },
];

export const WAIT_CONDITIONS: { value: WaitCondition; label: string }[] = [
  { value: "time", label: "Fixed time" },
  { value: "element_visible", label: "Element visible" },
  { value: "element_hidden", label: "Element hidden" },
  { value: "url_contains", label: "URL contains" },
];
