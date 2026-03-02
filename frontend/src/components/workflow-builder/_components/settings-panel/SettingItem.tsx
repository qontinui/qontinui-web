import React from "react";
import { Input } from "@/components/ui/input";
import { Info } from "lucide-react";
import type {
  SettingDef,
  BooleanSettingDef,
  NumberSettingDef,
  SelectSettingDef,
} from "@qontinui/workflow-utils";
import {
  getBooleanDisplayValue,
  toBooleanStoredValue,
} from "@qontinui/workflow-utils";
import { CustomSettingItem } from "./CustomSettingItem";
import type { SettingRenderProps } from "./types";

function BooleanSetting({
  def,
  workflow,
  updateWorkflow,
}: SettingRenderProps & { def: BooleanSettingDef }) {
  const displayValue = getBooleanDisplayValue(
    def,
    (workflow as never)[def.key]
  );
  return (
    <label
      key={def.key}
      className="flex items-center gap-2 text-sm text-zinc-400"
    >
      <input
        type="checkbox"
        className="rounded"
        checked={displayValue}
        onChange={(e) =>
          updateWorkflow({
            [def.key]: toBooleanStoredValue(def, e.target.checked),
          })
        }
      />
      {def.label}
      {def.tooltip && (
        <span className="relative group">
          <Info className="w-3.5 h-3.5 text-zinc-500 cursor-help" />
          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-64 p-2.5 bg-zinc-700 border border-zinc-600 rounded-lg text-[11px] text-zinc-300 leading-relaxed z-50 shadow-lg pointer-events-none">
            {def.tooltip}
          </span>
        </span>
      )}
    </label>
  );
}

function NumberSetting({
  def,
  workflow,
  updateWorkflow,
}: SettingRenderProps & { def: NumberSettingDef }) {
  return (
    <div key={def.key}>
      <label
        htmlFor={`sp-${def.key}`}
        className="block text-xs font-medium text-zinc-400 mb-1"
      >
        {def.label}
      </label>
      <Input
        id={`sp-${def.key}`}
        type="number"
        className="bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
        placeholder={def.placeholder}
        min={def.min}
        max={def.max}
        value={(workflow as never)[def.key] ?? ""}
        onChange={(e) =>
          updateWorkflow({
            [def.key]: e.target.value
              ? parseInt(e.target.value)
              : def.key === "timeout_seconds"
                ? null
                : undefined,
          })
        }
      />
      {def.description && (
        <p className="mt-1 text-[10px] text-zinc-500">{def.description}</p>
      )}
    </div>
  );
}

function SelectSetting({
  def,
  workflow,
  updateWorkflow,
  selectClass,
}: SettingRenderProps & { def: SelectSettingDef }) {
  return (
    <div key={def.key}>
      <label
        htmlFor={`sp-${def.key}`}
        className="block text-xs font-medium text-zinc-400 mb-1"
      >
        {def.label}
      </label>
      <select
        id={`sp-${def.key}`}
        className={selectClass}
        value={((workflow as never)[def.key] as string) ?? def.defaultValue}
        onChange={(e) =>
          updateWorkflow({
            [def.key]: e.target.value || undefined,
            ...(def.key === "provider" ? { model: undefined } : {}),
          })
        }
      >
        {def.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {def.description && (
        <p className="mt-1 text-[10px] text-zinc-500">{def.description}</p>
      )}
    </div>
  );
}

export function SettingItem({
  def,
  workflow,
  updateWorkflow,
  selectClass,
  onOpenPromptTemplate,
}: SettingRenderProps & {
  def: SettingDef;
  onOpenPromptTemplate: () => void;
}) {
  const props = { workflow, updateWorkflow, selectClass };
  switch (def.type) {
    case "boolean":
      return <BooleanSetting def={def} {...props} />;
    case "number":
      return <NumberSetting def={def} {...props} />;
    case "select":
      return <SelectSetting def={def} {...props} />;
    case "custom":
      return (
        <CustomSettingItem
          def={def}
          {...props}
          onOpenPromptTemplate={onOpenPromptTemplate}
        />
      );
  }
}

export { BooleanSetting };
