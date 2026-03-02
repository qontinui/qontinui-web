import React from "react";
import type {
  SettingDef,
  BooleanSettingDef,
  SettingsSection,
} from "@qontinui/workflow-utils";
import { SettingItem, BooleanSetting } from "./SettingItem";
import type { SettingRenderProps } from "./types";

export function SectionBlock({
  section,
  workflow,
  updateWorkflow,
  selectClass,
  onOpenPromptTemplate,
}: SettingRenderProps & {
  section: SettingsSection;
  onOpenPromptTemplate: () => void;
}) {
  const itemProps = {
    workflow,
    updateWorkflow,
    selectClass,
    onOpenPromptTemplate,
  };

  const renderItem = (def: SettingDef) => (
    <SettingItem key={def.key} def={def} {...itemProps} />
  );

  const booleans = section.settings.filter(
    (s) => s.type === "boolean"
  ) as BooleanSettingDef[];
  const others = section.settings.filter((s) => s.type !== "boolean");

  if (section.id === "identity") {
    return (
      <React.Fragment key={section.id}>
        {section.settings.map(renderItem)}
      </React.Fragment>
    );
  }

  if (section.id === "metadata") {
    return (
      <div key={section.id} className="grid grid-cols-2 gap-3">
        {section.settings.map(renderItem)}
      </div>
    );
  }

  if (section.id === "iteration") {
    return (
      <div key={section.id} className="grid grid-cols-2 gap-3">
        {section.settings.map(renderItem)}
      </div>
    );
  }

  if (section.id === "ai") {
    const providerDef = others.find((s) => s.key === "provider");
    const modelDef = others.find((s) => s.key === "model");
    const otherCustom = others.filter(
      (s) => s.key !== "provider" && s.key !== "model"
    );
    return (
      <React.Fragment key={section.id}>
        {(providerDef || modelDef) && (
          <div className="grid grid-cols-2 gap-3">
            {providerDef && renderItem(providerDef)}
            {modelDef && renderItem(modelDef)}
          </div>
        )}
        {otherCustom.map(renderItem)}
        {booleans.length > 0 && (
          <div className="space-y-2">
            {booleans.map((def) => (
              <BooleanSetting
                key={def.key}
                def={def}
                workflow={workflow}
                updateWorkflow={updateWorkflow}
                selectClass={selectClass}
              />
            ))}
          </div>
        )}
      </React.Fragment>
    );
  }

  return (
    <React.Fragment key={section.id}>
      {others.map(renderItem)}
      {booleans.length > 0 && (
        <div className="space-y-2">
          {booleans.map((def) => (
            <BooleanSetting
              key={def.key}
              def={def}
              workflow={workflow}
              updateWorkflow={updateWorkflow}
              selectClass={selectClass}
            />
          ))}
        </div>
      )}
    </React.Fragment>
  );
}
