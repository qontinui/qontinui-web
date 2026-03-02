import React from "react";
import { LayoutStyle } from "@/lib/workflow-layout/auto-layout";

interface LayoutOptionProps {
  style: LayoutStyle;
  name: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}

export function LayoutOption({
  style,
  name,
  description,
  selected,
  onClick,
}: LayoutOptionProps) {
  return (
    <div
      className={`layout-option ${selected ? "selected" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="layout-preview">
        <LayoutPreviewIcon style={style} />
      </div>
      <div className="layout-info">
        <strong>{name}</strong>
        <p>{description}</p>
      </div>
    </div>
  );
}

function LayoutPreviewIcon({ style }: { style: LayoutStyle }) {
  switch (style) {
    case LayoutStyle.HIERARCHICAL:
      return (
        <svg width="60" height="60" viewBox="0 0 60 60">
          <rect
            x="20"
            y="5"
            width="20"
            height="12"
            fill="currentColor"
            opacity="0.7"
            rx="2"
          />
          <rect
            x="5"
            y="25"
            width="20"
            height="12"
            fill="currentColor"
            opacity="0.7"
            rx="2"
          />
          <rect
            x="35"
            y="25"
            width="20"
            height="12"
            fill="currentColor"
            opacity="0.7"
            rx="2"
          />
          <rect
            x="20"
            y="45"
            width="20"
            height="12"
            fill="currentColor"
            opacity="0.7"
            rx="2"
          />
          <path
            d="M30 17 L15 25 M30 17 L45 25 M15 37 L30 45 M45 37 L30 45"
            stroke="currentColor"
            fill="none"
            opacity="0.5"
          />
        </svg>
      );
    case LayoutStyle.HORIZONTAL:
      return (
        <svg width="60" height="60" viewBox="0 0 60 60">
          <rect
            x="5"
            y="24"
            width="12"
            height="12"
            fill="currentColor"
            opacity="0.7"
            rx="2"
          />
          <rect
            x="24"
            y="24"
            width="12"
            height="12"
            fill="currentColor"
            opacity="0.7"
            rx="2"
          />
          <rect
            x="43"
            y="24"
            width="12"
            height="12"
            fill="currentColor"
            opacity="0.7"
            rx="2"
          />
          <path
            d="M17 30 L24 30 M36 30 L43 30"
            stroke="currentColor"
            fill="none"
            opacity="0.5"
            strokeWidth="2"
          />
        </svg>
      );
    case LayoutStyle.TREE:
      return (
        <svg width="60" height="60" viewBox="0 0 60 60">
          <rect
            x="25"
            y="5"
            width="10"
            height="10"
            fill="currentColor"
            opacity="0.7"
            rx="1"
          />
          <rect
            x="10"
            y="20"
            width="10"
            height="10"
            fill="currentColor"
            opacity="0.7"
            rx="1"
          />
          <rect
            x="25"
            y="20"
            width="10"
            height="10"
            fill="currentColor"
            opacity="0.7"
            rx="1"
          />
          <rect
            x="40"
            y="20"
            width="10"
            height="10"
            fill="currentColor"
            opacity="0.7"
            rx="1"
          />
          <rect
            x="5"
            y="35"
            width="10"
            height="10"
            fill="currentColor"
            opacity="0.7"
            rx="1"
          />
          <rect
            x="25"
            y="35"
            width="10"
            height="10"
            fill="currentColor"
            opacity="0.7"
            rx="1"
          />
          <rect
            x="45"
            y="35"
            width="10"
            height="10"
            fill="currentColor"
            opacity="0.7"
            rx="1"
          />
          <path
            d="M30 15 L15 20 M30 15 L30 20 M30 15 L45 20 M15 30 L10 35 M30 30 L30 35 M45 30 L50 35"
            stroke="currentColor"
            fill="none"
            opacity="0.3"
          />
        </svg>
      );
    default:
      return null;
  }
}
