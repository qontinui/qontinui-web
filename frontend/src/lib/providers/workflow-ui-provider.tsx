"use client";

import React from "react";
import { UIProvider } from "@qontinui/workflow-ui";
import type {
  CollapsibleProps,
  CollapsibleTriggerProps,
  CollapsibleContentProps,
} from "@qontinui/workflow-ui";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";

/**
 * Wires Radix Collapsible primitives into the shared workflow-ui components.
 * This gives PhaseSectionConcrete proper animated expand/collapse in the web app.
 */
export function WorkflowUIProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <UIProvider
      primitives={{
        Collapsible:
          Collapsible as unknown as React.ComponentType<CollapsibleProps>,
        CollapsibleTrigger:
          CollapsibleTrigger as unknown as React.ComponentType<CollapsibleTriggerProps>,
        CollapsibleContent:
          CollapsibleContent as unknown as React.ComponentType<CollapsibleContentProps>,
      }}
    >
      {children}
    </UIProvider>
  );
}
