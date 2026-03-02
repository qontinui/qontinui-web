import React from "react";

export interface FormatInfo {
  title: string;
  description: string;
  useCases: string[];
  advantages: string[];
  disadvantages: string[];
  icon: string;
}

export const FORMAT_INFO: Record<"sequential" | "graph", FormatInfo> = {
  sequential: {
    title: "Sequential Format",
    description: "Actions execute in order, one after another",
    icon: "📋",
    useCases: [
      "Simple automation scripts",
      "Form filling workflows",
      "Linear test scenarios",
      "Step-by-step procedures",
    ],
    advantages: [
      "Easy to understand",
      "Clear execution order",
      "Simple to debug",
      "Compact representation",
    ],
    disadvantages: [
      "Limited branching",
      "No parallel execution",
      "Less flexible",
      "Cannot represent complex flows",
    ],
  },
  graph: {
    title: "Graph Format",
    description: "Actions connected as nodes with flexible flow control",
    icon: "🕸️",
    useCases: [
      "Complex workflows with branching",
      "Error handling and retry logic",
      "Parallel execution paths",
      "State machines",
    ],
    advantages: [
      "Powerful branching",
      "Visual workflow structure",
      "Parallel execution support",
      "Flexible connections",
    ],
    disadvantages: [
      "More complex to understand",
      "Can become cluttered",
      "Requires layout management",
      "Harder to debug",
    ],
  },
};

interface FormatCardProps {
  format: "sequential" | "graph";
  info: FormatInfo;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}

export function FormatCard({
  format: _format,
  info,
  selected,
  disabled,
  onClick,
}: FormatCardProps) {
  return (
    <div
      className={`format-card ${selected ? "selected" : ""} ${disabled ? "disabled" : ""}`}
      role="button"
      tabIndex={0}
      onClick={disabled ? undefined : onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (!disabled) onClick?.();
        }
      }}
    >
      <div className="format-icon">{info.icon}</div>
      <h4>{info.title}</h4>
      <p className="description">{info.description}</p>

      <div className="format-details">
        <div className="detail-section">
          <strong>When to use:</strong>
          <ul>
            {info.useCases.map((useCase, i) => (
              <li key={i}>{useCase}</li>
            ))}
          </ul>
        </div>

        <div className="detail-section">
          <strong>Advantages:</strong>
          <ul>
            {info.advantages.slice(0, 3).map((adv, i) => (
              <li key={i} className="advantage">
                ✓ {adv}
              </li>
            ))}
          </ul>
        </div>

        <div className="detail-section">
          <strong>Limitations:</strong>
          <ul>
            {info.disadvantages.slice(0, 2).map((dis, i) => (
              <li key={i} className="disadvantage">
                • {dis}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {disabled && <div className="current-format-badge">Current Format</div>}
    </div>
  );
}
