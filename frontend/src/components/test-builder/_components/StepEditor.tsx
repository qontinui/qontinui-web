"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  AnalyzedElement,
  SpecStep,
  NavigateStep,
  InteractStep,
  AssertStep,
  WaitStep,
  ScreenshotStep,
  InteractionAction,
  AssertionKind,
  WaitCondition,
} from "../spec-workflow-types";
import {
  INTERACTION_ACTIONS,
  ASSERTION_KINDS,
  WAIT_CONDITIONS,
} from "../spec-workflow-types";
import { ElementPickerInline } from "./ElementPickerInline";

// ---------------------------------------------------------------------------
// Step Editor Props
// ---------------------------------------------------------------------------

interface StepEditorProps {
  step: SpecStep;
  elements: AnalyzedElement[];
  onChange: (updated: SpecStep) => void;
}

// ---------------------------------------------------------------------------
// Navigate Step Editor
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Interact Step Editor
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Assert Step Editor
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Wait Step Editor
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Screenshot Step Editor
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// StepEditor (delegates to type-specific editors)
// ---------------------------------------------------------------------------

export function StepEditor({ step, elements, onChange }: StepEditorProps) {
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
