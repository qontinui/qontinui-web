"use client";

/**
 * SpecWorkflowBuilder
 *
 * Creates workflow-driven test specifications from page analysis data.
 * Accepts element lists from a page analyzer and allows the user to
 * compose ordered test steps (navigate, interact, assert, wait, screenshot)
 * that reference discovered elements.
 *
 * Layout:
 *   Left panel  - ordered step list with add / remove / reorder
 *   Right panel - dynamic step editor based on selected step type
 *   Bottom bar  - "Generate Test Code" action + code preview
 */

import React, { useState, useCallback, useMemo } from "react";
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Navigation,
  MousePointerClick,
  ShieldCheck,
  Timer,
  Camera,
  Code,
  Copy,
  Check,
  Layers,
  Search,
  X,
  GripVertical,
  Play,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

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

const STEP_TYPE_META: Record<
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

const INTERACTION_ACTIONS: { value: InteractionAction; label: string }[] = [
  { value: "click", label: "Click" },
  { value: "type", label: "Type text" },
  { value: "hover", label: "Hover" },
  { value: "focus", label: "Focus" },
  { value: "clear", label: "Clear" },
];

const ASSERTION_KINDS: { value: AssertionKind; label: string }[] = [
  { value: "visible", label: "Is visible" },
  { value: "hidden", label: "Is hidden" },
  { value: "text_equals", label: "Text equals" },
  { value: "text_contains", label: "Text contains" },
  { value: "has_attribute", label: "Has attribute" },
  { value: "is_enabled", label: "Is enabled" },
  { value: "is_disabled", label: "Is disabled" },
  { value: "exists", label: "Exists in DOM" },
];

const WAIT_CONDITIONS: { value: WaitCondition; label: string }[] = [
  { value: "time", label: "Fixed time" },
  { value: "element_visible", label: "Element visible" },
  { value: "element_hidden", label: "Element hidden" },
  { value: "url_contains", label: "URL contains" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createId(): string {
  return `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createDefaultStep(type: SpecStepType): SpecStep {
  const id = createId();
  switch (type) {
    case "navigate":
      return { id, type, name: "Navigate", url: "" };
    case "interact":
      return {
        id,
        type,
        name: "Interact",
        elementId: null,
        action: "click",
      };
    case "assert":
      return {
        id,
        type,
        name: "Assert",
        elementId: null,
        assertion: "visible",
      };
    case "wait":
      return {
        id,
        type,
        name: "Wait",
        condition: "time",
        timeoutMs: 1000,
      };
    case "screenshot":
      return {
        id,
        type,
        name: "Screenshot",
        label: "screenshot",
        fullPage: false,
      };
  }
}

function resolveSelector(
  elementId: string | null | undefined,
  elements: AnalyzedElement[]
): string {
  if (!elementId) return "'TODO: select element'";
  const el = elements.find((e) => e.id === elementId);
  if (!el) return `'[unknown element ${elementId}]'`;
  if (el.selector) return `'${el.selector}'`;
  // Fall back to a descriptive locator
  const tag = el.tagName.toLowerCase();
  if (el.text) return `page.getByRole('${tag}', { name: '${el.text}' })`;
  return `'${tag}#${el.id}'`;
}

function generatePlaywrightCode(
  steps: SpecStep[],
  elements: AnalyzedElement[]
): string {
  const lines: string[] = [
    `import { test, expect } from "@playwright/test";`,
    ``,
    `test("generated spec test", async ({ page }) => {`,
  ];

  for (const step of steps) {
    lines.push(`  // ${step.name}`);
    switch (step.type) {
      case "navigate":
        lines.push(`  await page.goto('${step.url}');`);
        break;
      case "interact": {
        const sel = resolveSelector(step.elementId, elements);
        switch (step.action) {
          case "click":
            lines.push(`  await page.locator(${sel}).click();`);
            break;
          case "type":
            lines.push(
              `  await page.locator(${sel}).fill('${step.value ?? ""}');`
            );
            break;
          case "hover":
            lines.push(`  await page.locator(${sel}).hover();`);
            break;
          case "focus":
            lines.push(`  await page.locator(${sel}).focus();`);
            break;
          case "clear":
            lines.push(`  await page.locator(${sel}).fill('');`);
            break;
        }
        break;
      }
      case "assert": {
        const sel = resolveSelector(step.elementId, elements);
        switch (step.assertion) {
          case "visible":
            lines.push(`  await expect(page.locator(${sel})).toBeVisible();`);
            break;
          case "hidden":
            lines.push(`  await expect(page.locator(${sel})).toBeHidden();`);
            break;
          case "text_equals":
            lines.push(
              `  await expect(page.locator(${sel})).toHaveText('${step.expected ?? ""}');`
            );
            break;
          case "text_contains":
            lines.push(
              `  await expect(page.locator(${sel})).toContainText('${step.expected ?? ""}');`
            );
            break;
          case "has_attribute":
            lines.push(
              `  await expect(page.locator(${sel})).toHaveAttribute('${step.attributeName ?? ""}', '${step.expected ?? ""}');`
            );
            break;
          case "is_enabled":
            lines.push(`  await expect(page.locator(${sel})).toBeEnabled();`);
            break;
          case "is_disabled":
            lines.push(`  await expect(page.locator(${sel})).toBeDisabled();`);
            break;
          case "exists":
            lines.push(`  await expect(page.locator(${sel})).toHaveCount(1);`);
            break;
        }
        break;
      }
      case "wait":
        switch (step.condition) {
          case "time":
            lines.push(`  await page.waitForTimeout(${step.timeoutMs});`);
            break;
          case "element_visible": {
            const sel = resolveSelector(step.elementId, elements);
            lines.push(
              `  await page.locator(${sel}).waitFor({ state: 'visible', timeout: ${step.timeoutMs} });`
            );
            break;
          }
          case "element_hidden": {
            const sel = resolveSelector(step.elementId, elements);
            lines.push(
              `  await page.locator(${sel}).waitFor({ state: 'hidden', timeout: ${step.timeoutMs} });`
            );
            break;
          }
          case "url_contains":
            lines.push(
              `  await page.waitForURL('**/*${step.value ?? ""}*', { timeout: ${step.timeoutMs} });`
            );
            break;
        }
        break;
      case "screenshot":
        if (step.fullPage) {
          lines.push(
            `  await page.screenshot({ path: '${step.label}.png', fullPage: true });`
          );
        } else {
          lines.push(`  await page.screenshot({ path: '${step.label}.png' });`);
        }
        break;
    }
    lines.push(``);
  }

  lines.push(`});`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Sortable Step Item
// ---------------------------------------------------------------------------

interface SortableStepItemProps {
  step: SpecStep;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  isFirst: boolean;
  isLast: boolean;
}

function SortableStepItem({
  step,
  index,
  isSelected,
  onSelect,
  onMoveUp,
  onMoveDown,
  onDelete,
  isFirst,
  isLast,
}: SortableStepItemProps) {
  const meta = STEP_TYPE_META[step.type];
  const Icon = meta.icon;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer transition-colors",
        isDragging && "opacity-50",
        isSelected
          ? "bg-zinc-700/80 ring-1 ring-zinc-500"
          : "hover:bg-zinc-800/60"
      )}
      onClick={onSelect}
    >
      {/* Drag handle */}
      <button
        className="touch-none cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-400 shrink-0"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>

      {/* Step number */}
      <span className="shrink-0 w-5 h-5 flex items-center justify-center bg-zinc-700 text-zinc-300 text-xs font-medium rounded">
        {index + 1}
      </span>

      {/* Icon */}
      <Icon className={cn("w-4 h-4 shrink-0", meta.color)} />

      {/* Name + type */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-zinc-200 truncate">{step.name}</div>
        <div className="text-xs text-zinc-500 truncate">{meta.label}</div>
      </div>

      {/* Reorder + delete */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0"
          disabled={isFirst}
          onClick={(e) => {
            e.stopPropagation();
            onMoveUp();
          }}
          title="Move up"
        >
          <ChevronUp className="w-3 h-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0"
          disabled={isLast}
          onClick={(e) => {
            e.stopPropagation();
            onMoveDown();
          }}
          title="Move down"
        >
          <ChevronDown className="w-3 h-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0 text-red-400 hover:text-red-300"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete step"
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Element Picker (inline)
// ---------------------------------------------------------------------------

interface ElementPickerInlineProps {
  elements: AnalyzedElement[];
  selectedId: string | null | undefined;
  onSelect: (id: string) => void;
}

function ElementPickerInline({
  elements,
  selectedId,
  onSelect,
}: ElementPickerInlineProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return elements;
    const q = search.toLowerCase();
    return elements.filter(
      (el) =>
        el.id.toLowerCase().includes(q) ||
        el.label.toLowerCase().includes(q) ||
        el.type.toLowerCase().includes(q) ||
        el.text?.toLowerCase().includes(q) ||
        el.selector?.toLowerCase().includes(q)
    );
  }, [elements, search]);

  return (
    <div className="border border-zinc-700 rounded-md overflow-hidden bg-zinc-900/50">
      {/* Search bar */}
      <div className="p-2 border-b border-zinc-800">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
          <Input
            placeholder="Search elements..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 pl-7 pr-7 text-xs bg-zinc-800 border-zinc-700"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Element list */}
      <div className="max-h-48 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="p-3 text-xs text-zinc-500 text-center">
            No elements found
          </div>
        )}
        {filtered.map((el) => {
          const isActive = selectedId === el.id;
          return (
            <button
              key={el.id}
              onClick={() => onSelect(el.id)}
              className={cn(
                "w-full flex items-start gap-2 px-3 py-2 text-left transition-colors border-b border-zinc-800/50 last:border-b-0",
                isActive
                  ? "bg-blue-500/10 border-l-2 border-l-blue-500"
                  : "hover:bg-zinc-800/60"
              )}
            >
              <Layers className="w-3.5 h-3.5 text-zinc-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-zinc-200 truncate">{el.label}</div>
                <div className="text-[10px] text-zinc-500 truncate">
                  {el.tagName}
                  {el.type !== el.tagName ? ` (${el.type})` : ""}
                  {el.text ? ` - "${el.text}"` : ""}
                </div>
                {el.selector && (
                  <div className="text-[10px] text-zinc-600 font-mono truncate mt-0.5">
                    {el.selector}
                  </div>
                )}
              </div>
              {isActive && (
                <Check className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step Editor Forms
// ---------------------------------------------------------------------------

interface StepEditorProps {
  step: SpecStep;
  elements: AnalyzedElement[];
  onChange: (updated: SpecStep) => void;
}

function NavigateStepEditor({
  step,
  onChange,
}: {
  step: NavigateStep;
  onChange: (s: NavigateStep) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs text-zinc-400">Step Name</Label>
        <Input
          value={step.name}
          onChange={(e) => onChange({ ...step, name: e.target.value })}
          className="bg-zinc-800 border-zinc-700 text-sm"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-zinc-400">URL</Label>
        <Input
          value={step.url}
          onChange={(e) => onChange({ ...step, url: e.target.value })}
          placeholder="https://example.com"
          className="bg-zinc-800 border-zinc-700 text-sm"
        />
      </div>
    </div>
  );
}

function InteractStepEditor({
  step,
  elements,
  onChange,
}: {
  step: InteractStep;
  elements: AnalyzedElement[];
  onChange: (s: InteractStep) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs text-zinc-400">Step Name</Label>
        <Input
          value={step.name}
          onChange={(e) => onChange({ ...step, name: e.target.value })}
          className="bg-zinc-800 border-zinc-700 text-sm"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-zinc-400">Action</Label>
        <Select
          value={step.action}
          onValueChange={(v) =>
            onChange({ ...step, action: v as InteractionAction })
          }
        >
          <SelectTrigger className="bg-zinc-800 border-zinc-700 text-sm w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INTERACTION_ACTIONS.map((a) => (
              <SelectItem key={a.value} value={a.value}>
                {a.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-zinc-400">Target Element</Label>
        <ElementPickerInline
          elements={elements}
          selectedId={step.elementId}
          onSelect={(id) => onChange({ ...step, elementId: id })}
        />
      </div>

      {step.action === "type" && (
        <div className="space-y-2">
          <Label className="text-xs text-zinc-400">Text to type</Label>
          <Input
            value={step.value ?? ""}
            onChange={(e) => onChange({ ...step, value: e.target.value })}
            placeholder="Enter text..."
            className="bg-zinc-800 border-zinc-700 text-sm"
          />
        </div>
      )}
    </div>
  );
}

function AssertStepEditor({
  step,
  elements,
  onChange,
}: {
  step: AssertStep;
  elements: AnalyzedElement[];
  onChange: (s: AssertStep) => void;
}) {
  const needsExpected = [
    "text_equals",
    "text_contains",
    "has_attribute",
  ].includes(step.assertion);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs text-zinc-400">Step Name</Label>
        <Input
          value={step.name}
          onChange={(e) => onChange({ ...step, name: e.target.value })}
          className="bg-zinc-800 border-zinc-700 text-sm"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-zinc-400">Assertion</Label>
        <Select
          value={step.assertion}
          onValueChange={(v) =>
            onChange({ ...step, assertion: v as AssertionKind })
          }
        >
          <SelectTrigger className="bg-zinc-800 border-zinc-700 text-sm w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ASSERTION_KINDS.map((a) => (
              <SelectItem key={a.value} value={a.value}>
                {a.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-zinc-400">Target Element</Label>
        <ElementPickerInline
          elements={elements}
          selectedId={step.elementId}
          onSelect={(id) => onChange({ ...step, elementId: id })}
        />
      </div>

      {step.assertion === "has_attribute" && (
        <div className="space-y-2">
          <Label className="text-xs text-zinc-400">Attribute Name</Label>
          <Input
            value={step.attributeName ?? ""}
            onChange={(e) =>
              onChange({ ...step, attributeName: e.target.value })
            }
            placeholder="data-testid"
            className="bg-zinc-800 border-zinc-700 text-sm"
          />
        </div>
      )}

      {needsExpected && (
        <div className="space-y-2">
          <Label className="text-xs text-zinc-400">Expected Value</Label>
          <Input
            value={step.expected ?? ""}
            onChange={(e) => onChange({ ...step, expected: e.target.value })}
            placeholder="Expected value..."
            className="bg-zinc-800 border-zinc-700 text-sm"
          />
        </div>
      )}
    </div>
  );
}

function WaitStepEditor({
  step,
  elements,
  onChange,
}: {
  step: WaitStep;
  elements: AnalyzedElement[];
  onChange: (s: WaitStep) => void;
}) {
  const needsElement = ["element_visible", "element_hidden"].includes(
    step.condition
  );

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs text-zinc-400">Step Name</Label>
        <Input
          value={step.name}
          onChange={(e) => onChange({ ...step, name: e.target.value })}
          className="bg-zinc-800 border-zinc-700 text-sm"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-zinc-400">Condition</Label>
        <Select
          value={step.condition}
          onValueChange={(v) =>
            onChange({ ...step, condition: v as WaitCondition })
          }
        >
          <SelectTrigger className="bg-zinc-800 border-zinc-700 text-sm w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WAIT_CONDITIONS.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-zinc-400">Timeout (ms)</Label>
        <Input
          type="number"
          value={step.timeoutMs}
          onChange={(e) =>
            onChange({ ...step, timeoutMs: parseInt(e.target.value) || 0 })
          }
          className="bg-zinc-800 border-zinc-700 text-sm"
        />
      </div>

      {needsElement && (
        <div className="space-y-2">
          <Label className="text-xs text-zinc-400">Target Element</Label>
          <ElementPickerInline
            elements={elements}
            selectedId={step.elementId}
            onSelect={(id) => onChange({ ...step, elementId: id })}
          />
        </div>
      )}

      {step.condition === "url_contains" && (
        <div className="space-y-2">
          <Label className="text-xs text-zinc-400">URL fragment</Label>
          <Input
            value={step.value ?? ""}
            onChange={(e) => onChange({ ...step, value: e.target.value })}
            placeholder="/dashboard"
            className="bg-zinc-800 border-zinc-700 text-sm"
          />
        </div>
      )}
    </div>
  );
}

function ScreenshotStepEditor({
  step,
  onChange,
}: {
  step: ScreenshotStep;
  onChange: (s: ScreenshotStep) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs text-zinc-400">Step Name</Label>
        <Input
          value={step.name}
          onChange={(e) => onChange({ ...step, name: e.target.value })}
          className="bg-zinc-800 border-zinc-700 text-sm"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-zinc-400">Screenshot Label</Label>
        <Input
          value={step.label}
          onChange={(e) => onChange({ ...step, label: e.target.value })}
          placeholder="screenshot-name"
          className="bg-zinc-800 border-zinc-700 text-sm"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="fullPage"
          checked={step.fullPage}
          onChange={(e) => onChange({ ...step, fullPage: e.target.checked })}
          className="rounded border-zinc-700"
        />
        <Label
          htmlFor="fullPage"
          className="text-xs text-zinc-400 cursor-pointer"
        >
          Capture full page
        </Label>
      </div>
    </div>
  );
}

function StepEditor({ step, elements, onChange }: StepEditorProps) {
  switch (step.type) {
    case "navigate":
      return <NavigateStepEditor step={step} onChange={(s) => onChange(s)} />;
    case "interact":
      return (
        <InteractStepEditor
          step={step}
          elements={elements}
          onChange={(s) => onChange(s)}
        />
      );
    case "assert":
      return (
        <AssertStepEditor
          step={step}
          elements={elements}
          onChange={(s) => onChange(s)}
        />
      );
    case "wait":
      return (
        <WaitStepEditor
          step={step}
          elements={elements}
          onChange={(s) => onChange(s)}
        />
      );
    case "screenshot":
      return <ScreenshotStepEditor step={step} onChange={(s) => onChange(s)} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// SpecWorkflowBuilder (main component)
// ---------------------------------------------------------------------------

export interface SpecWorkflowBuilderProps {
  /** Elements discovered by the page analyzer */
  elements: AnalyzedElement[];
  /** Called when the user clicks "Generate Test Code" */
  onGenerate?: (code: string, steps: SpecStep[]) => void;
  /** Optional initial steps to pre-populate */
  initialSteps?: SpecStep[];
  /** Optional class name */
  className?: string;
}

export function SpecWorkflowBuilder({
  elements,
  onGenerate,
  initialSteps,
  className,
}: SpecWorkflowBuilderProps) {
  const [steps, setSteps] = useState<SpecStep[]>(initialSteps ?? []);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);

  const selectedStep = useMemo(
    () => steps.find((s) => s.id === selectedStepId) ?? null,
    [steps, selectedStepId]
  );

  const generatedCode = useMemo(
    () => generatePlaywrightCode(steps, elements),
    [steps, elements]
  );

  // --- DnD sensors ---
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // --- Step CRUD ---
  const addStep = useCallback((type: SpecStepType) => {
    const newStep = createDefaultStep(type);
    setSteps((prev) => [...prev, newStep]);
    setSelectedStepId(newStep.id);
  }, []);

  const updateStep = useCallback((updated: SpecStep) => {
    setSteps((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }, []);

  const deleteStep = useCallback(
    (stepId: string) => {
      setSteps((prev) => prev.filter((s) => s.id !== stepId));
      if (selectedStepId === stepId) {
        setSelectedStepId(null);
      }
    },
    [selectedStepId]
  );

  const moveStep = useCallback((index: number, direction: -1 | 1) => {
    setSteps((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const a = next[index];
      const b = next[target];
      if (!a || !b) return prev;
      next[index] = b;
      next[target] = a;
      return next;
    });
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSteps((prev) => {
      const oldIndex = prev.findIndex((s) => s.id === active.id);
      const newIndex = prev.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      const next = [...prev];
      const moved = next.splice(oldIndex, 1)[0];
      if (!moved) return prev;
      next.splice(newIndex, 0, moved);
      return next;
    });
  }, []);

  // --- Clipboard ---
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(generatedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [generatedCode]);

  const handleGenerate = useCallback(() => {
    setShowCode(true);
    onGenerate?.(generatedCode, steps);
  }, [generatedCode, steps, onGenerate]);

  return (
    <div
      className={cn(
        "flex flex-col h-full bg-zinc-900 rounded-lg border border-zinc-700 overflow-hidden",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 bg-zinc-800/50">
        <div className="flex items-center gap-2">
          <Play className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-medium text-zinc-200">
            Spec Workflow Builder
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
            {steps.length} step{steps.length !== 1 ? "s" : ""}
          </Badge>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
            {elements.length} element{elements.length !== 1 ? "s" : ""}
          </Badge>
        </div>
      </div>

      {/* Main content: step list (left) + editor (right) */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left panel: step list */}
        <div className="w-72 flex flex-col border-r border-zinc-700 shrink-0">
          {/* Add step buttons */}
          <div className="p-2 border-b border-zinc-800 bg-zinc-800/30">
            <div className="flex flex-wrap gap-1">
              {(
                Object.entries(STEP_TYPE_META) as [
                  SpecStepType,
                  (typeof STEP_TYPE_META)[SpecStepType],
                ][]
              ).map(([type, meta]) => {
                const Icon = meta.icon;
                return (
                  <Button
                    key={type}
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1"
                    onClick={() => addStep(type)}
                    title={`Add ${meta.label} step`}
                  >
                    <Plus className="w-3 h-3" />
                    <Icon className={cn("w-3 h-3", meta.color)} />
                    <span className="text-zinc-400">{meta.label}</span>
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Step list */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-2 space-y-1">
              {steps.length === 0 && (
                <div className="text-center py-8 text-zinc-500 text-xs">
                  No steps yet. Add a step above.
                </div>
              )}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={steps.map((s) => s.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {steps.map((step, i) => (
                    <SortableStepItem
                      key={step.id}
                      step={step}
                      index={i}
                      isSelected={selectedStepId === step.id}
                      onSelect={() => setSelectedStepId(step.id)}
                      onMoveUp={() => moveStep(i, -1)}
                      onMoveDown={() => moveStep(i, 1)}
                      onDelete={() => deleteStep(step.id)}
                      isFirst={i === 0}
                      isLast={i === steps.length - 1}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          </ScrollArea>
        </div>

        {/* Right panel: step editor or code preview */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {showCode ? (
            /* Code preview */
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-700 bg-zinc-800/30">
                <div className="flex items-center gap-2">
                  <Code className="w-4 h-4 text-blue-400" />
                  <span className="text-xs font-medium text-zinc-300">
                    Generated Playwright Test
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs gap-1"
                    onClick={handleCopy}
                  >
                    {copied ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setShowCode(false)}
                  >
                    Back to editor
                  </Button>
                </div>
              </div>
              <ScrollArea className="flex-1 min-h-0">
                <pre className="p-4 text-xs font-mono text-zinc-300 whitespace-pre-wrap">
                  {generatedCode}
                </pre>
              </ScrollArea>
            </div>
          ) : selectedStep ? (
            /* Step editor */
            <div className="flex flex-col h-full">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-700 bg-zinc-800/30">
                {React.createElement(STEP_TYPE_META[selectedStep.type].icon, {
                  className: cn(
                    "w-4 h-4",
                    STEP_TYPE_META[selectedStep.type].color
                  ),
                })}
                <span className="text-xs font-medium text-zinc-300">
                  Edit {STEP_TYPE_META[selectedStep.type].label} Step
                </span>
                <Badge variant="outline" className="text-[10px] ml-auto">
                  #{steps.findIndex((s) => s.id === selectedStep.id) + 1}
                </Badge>
              </div>
              <ScrollArea className="flex-1 min-h-0">
                <div className="p-4">
                  <StepEditor
                    step={selectedStep}
                    elements={elements}
                    onChange={updateStep}
                  />
                </div>
              </ScrollArea>
            </div>
          ) : (
            /* Empty state */
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-2">
                <ShieldCheck className="w-10 h-10 text-zinc-700 mx-auto" />
                <p className="text-sm text-zinc-500">
                  Select a step to edit, or add a new step.
                </p>
                <p className="text-xs text-zinc-600">
                  {elements.length > 0
                    ? `${elements.length} page elements available for reference.`
                    : "No page elements loaded. Run the page analyzer first."}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer: generate button */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-700 bg-zinc-800/50">
        <div className="text-xs text-zinc-500">
          {steps.length > 0
            ? `${steps.length} step${steps.length !== 1 ? "s" : ""} configured`
            : "Add steps to build a test specification"}
        </div>
        <div className="flex items-center gap-2">
          {showCode && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => setShowCode(false)}
            >
              Edit Steps
            </Button>
          )}
          <Button
            variant="brand-primary"
            size="sm"
            disabled={steps.length === 0}
            onClick={handleGenerate}
            className="gap-1.5"
          >
            <Code className="w-3.5 h-3.5" />
            Generate Test Code
          </Button>
        </div>
      </div>
    </div>
  );
}
