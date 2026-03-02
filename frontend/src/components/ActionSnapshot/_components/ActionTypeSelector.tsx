import React from "react";
import { Target, MousePointer, Type, Move } from "lucide-react";
import { ActionSnapshot } from "../../../lib/integration-testing-framework";

interface ActionTypeSelectorProps {
  actionTypes: ActionSnapshot["actionType"][];
  selectedType: ActionSnapshot["actionType"];
  onSelect: (type: ActionSnapshot["actionType"]) => void;
}

function getActionIcon(type: ActionSnapshot["actionType"]) {
  switch (type) {
    case "FIND":
      return <Target className="w-4 h-4" />;
    case "CLICK":
      return <MousePointer className="w-4 h-4" />;
    case "TYPE":
      return <Type className="w-4 h-4" />;
    case "DRAG":
      return <Move className="w-4 h-4" />;
    case "SCROLL":
      return <Move className="w-4 h-4 rotate-90" />;
    default:
      return <Target className="w-4 h-4" />;
  }
}

export const ActionTypeSelector: React.FC<ActionTypeSelectorProps> = ({
  actionTypes,
  selectedType,
  onSelect,
}) => {
  return (
    <div>
      <p className="block text-sm font-medium mb-2">Action Type</p>
      <div className="grid grid-cols-3 gap-2">
        {actionTypes.map((type) => (
          <button
            key={type}
            onClick={() => onSelect(type)}
            className={`flex items-center gap-2 px-3 py-2 rounded border transition-colors ${
              selectedType === type
                ? "bg-blue-50 border-blue-300 text-blue-700"
                : "bg-white border-border-default hover:bg-surface-raised/80"
            }`}
          >
            {getActionIcon(type)}
            <span className="text-sm">{type}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
