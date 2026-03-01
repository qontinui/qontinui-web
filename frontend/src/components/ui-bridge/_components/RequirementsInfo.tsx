"use client";

/**
 * Collapsible info section explaining how UI Bridge exploration works
 * and listing requirements for the current target type.
 */

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, Info } from "lucide-react";
import type { TargetTypeRequirement } from "../exploration-config-types";

interface RequirementsInfoProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  currentRequirements: TargetTypeRequirement;
}

export function RequirementsInfo({
  isOpen,
  onOpenChange,
  currentRequirements,
}: RequirementsInfoProps) {
  return (
    <Collapsible open={isOpen} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between text-text-muted hover:text-text-secondary"
        >
          <span className="flex items-center gap-2">
            <Info className="h-4 w-4" />
            How UI Bridge Exploration Works
          </span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        <Alert variant="info" className="border-blue-500/30 bg-blue-500/5">
          <Info className="h-4 w-4" />
          <AlertTitle>UI Bridge SDK Required</AlertTitle>
          <AlertDescription className="text-xs space-y-2">
            <p>
              UI Bridge exploration connects to applications that have the{" "}
              <strong>UI Bridge SDK</strong> installed. This is different from
              browser automation (like Playwright) which can work with any
              website.
            </p>
            <div className="mt-3 space-y-2">
              <p className="font-medium">
                Requirements for {currentRequirements.title}:
              </p>
              <ul className="list-disc list-inside space-y-1 text-text-muted">
                {currentRequirements.requirements.map((req, idx) => (
                  <li key={idx}>{req}</li>
                ))}
              </ul>
            </div>
            <p className="mt-3 text-text-muted">
              For browser automation without SDK requirements, use{" "}
              <span className="text-brand-primary">Playwright extraction</span>{" "}
              instead.
            </p>
          </AlertDescription>
        </Alert>
      </CollapsibleContent>
    </Collapsible>
  );
}
