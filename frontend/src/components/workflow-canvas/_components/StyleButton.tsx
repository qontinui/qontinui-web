import React from "react";
import { LayoutStyle } from "@/lib/workflow-layout/auto-layout";
import type { LayoutStyleInfo } from "../auto-layout-types";

interface StyleButtonProps {
  style: LayoutStyle;
  info: LayoutStyleInfo;
  selected: boolean;
  onClick: () => void;
}

export function StyleButton({
  style: _style,
  info,
  selected,
  onClick,
}: StyleButtonProps) {
  return (
    <button
      className={`style-button ${selected ? "selected" : ""}`}
      onClick={onClick}
    >
      <div className="style-icon">{info.icon}</div>
      <div className="style-info">
        <strong>{info.name}</strong>
        <p className="description">{info.description}</p>
        <div className="best-for">
          <small>Best for:</small>
          <ul>
            {info.bestFor.slice(0, 2).map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </button>
  );
}
