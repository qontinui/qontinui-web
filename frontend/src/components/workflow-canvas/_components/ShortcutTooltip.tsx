"use client";

import React from "react";
import { Tooltip } from "../Tooltip";

export function ShortcutTooltip({
  description,
  shortcut,
  children,
}: {
  description: string;
  shortcut: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip
      content={
        <div className="flex items-center justify-between gap-4">
          <span>{description}</span>
          <span className="text-xs px-2 py-1 bg-surface-raised rounded font-mono text-text-muted">
            {shortcut}
          </span>
        </div>
      }
      delay={500}
    >
      {children}
    </Tooltip>
  );
}
