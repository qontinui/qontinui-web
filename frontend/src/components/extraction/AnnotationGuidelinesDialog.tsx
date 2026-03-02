/**
 * Annotation Guidelines Dialog
 *
 * In-app documentation for annotators with comprehensive guidelines on:
 * - Getting started with annotation tools
 * - Element type descriptions
 * - Best practices for quality annotations
 * - Quality guidelines and standards
 */

"use client";

import { useState } from "react";
import { BookOpen } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GettingStartedSection } from "./_components/GettingStartedSection";
import { ElementTypesSection } from "./_components/ElementTypesSection";
import { BestPracticesSection } from "./_components/BestPracticesSection";
import { QualityGuidelinesSection } from "./_components/QualityGuidelinesSection";
import { KeyboardShortcutsSection } from "./_components/KeyboardShortcutsSection";

interface AnnotationGuidelinesDialogProps {
  trigger?: React.ReactNode;
}

export function AnnotationGuidelinesDialog({
  trigger,
}: AnnotationGuidelinesDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm">
            <BookOpen className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-[#9B59B6]" />
            Annotation Guidelines
          </DialogTitle>
          <DialogDescription>
            Reference guide for creating high-quality UI element annotations.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-3 py-4">
            <GettingStartedSection />
            <ElementTypesSection />
            <BestPracticesSection />
            <QualityGuidelinesSection />
            <KeyboardShortcutsSection />
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
