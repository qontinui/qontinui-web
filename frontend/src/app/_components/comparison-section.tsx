"use client";

import React from "react";
import { Card } from "@/components/ui/card";
import { X, Check } from "lucide-react";

export function ComparisonSection() {
  return (
    <section className="py-20 px-4">
      <div className="container mx-auto max-w-4xl">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-16">
          Beyond Basic AI Coding Tools
        </h2>

        <div className="grid md:grid-cols-2 gap-8">
          <Card className="p-8 bg-card/50 border-destructive/30 opacity-75">
            <h3 className="text-xl font-semibold mb-6 text-destructive flex items-center">
              <X className="h-5 w-5 mr-2" />
              Raw CLI Tools
            </h3>
            <ul className="space-y-3 text-muted-foreground">
              <li className="flex items-start gap-2">
                <X className="h-4 w-4 text-destructive mt-1 flex-shrink-0" />
                Single-shot prompts
              </li>
              <li className="flex items-start gap-2">
                <X className="h-4 w-4 text-destructive mt-1 flex-shrink-0" />
                No verification
              </li>
              <li className="flex items-start gap-2">
                <X className="h-4 w-4 text-destructive mt-1 flex-shrink-0" />
                No error monitoring
              </li>
              <li className="flex items-start gap-2">
                <X className="h-4 w-4 text-destructive mt-1 flex-shrink-0" />
                No persistent knowledge
              </li>
              <li className="flex items-start gap-2">
                <X className="h-4 w-4 text-destructive mt-1 flex-shrink-0" />
                Locked to one provider
              </li>
              <li className="flex items-start gap-2">
                <X className="h-4 w-4 text-destructive mt-1 flex-shrink-0" />
                No visual feedback
              </li>
            </ul>
          </Card>

          <Card className="p-8 bg-card border-primary/30 glow-cyan">
            <h3 className="text-xl font-semibold mb-6 text-primary flex items-center">
              <Check className="h-5 w-5 mr-2" />
              Qontinui Runner
            </h3>
            <ul className="space-y-3">
              <li className="flex items-start gap-2">
                <Check className="h-4 w-4 text-primary mt-1 flex-shrink-0" />
                Orchestrated multi-phase workflows
              </li>
              <li className="flex items-start gap-2">
                <Check className="h-4 w-4 text-primary mt-1 flex-shrink-0" />
                Automatic verification loops
              </li>
              <li className="flex items-start gap-2">
                <Check className="h-4 w-4 text-primary mt-1 flex-shrink-0" />
                Real-time error monitoring
              </li>
              <li className="flex items-start gap-2">
                <Check className="h-4 w-4 text-primary mt-1 flex-shrink-0" />
                Persistent knowledge base
              </li>
              <li className="flex items-start gap-2">
                <Check className="h-4 w-4 text-primary mt-1 flex-shrink-0" />
                Multi-provider support
              </li>
              <li className="flex items-start gap-2">
                <Check className="h-4 w-4 text-primary mt-1 flex-shrink-0" />
                UI Bridge visual feedback
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </section>
  );
}
