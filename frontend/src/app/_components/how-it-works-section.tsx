"use client";

import React from "react";
import { Card } from "@/components/ui/card";
import { ArrowRight, Settings, Sparkles, Bot } from "lucide-react";

export function HowItWorksSection() {
  return (
    <section className="py-20 px-4 bg-muted/20">
      <div className="container mx-auto max-w-4xl">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-16">
          How It Works
        </h2>

        <div className="flex flex-col md:flex-row items-center justify-between space-y-8 md:space-y-0 md:space-x-8">
          <div className="flex-1">
            <Card className="p-6 bg-card border-border text-center">
              <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Settings className="h-7 w-7 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Configure</h3>
              <p className="text-sm text-muted-foreground">
                Choose your AI provider and connect to your project. Set up log
                sources so AI can monitor your application.
              </p>
            </Card>
          </div>

          <ArrowRight className="h-8 w-8 text-muted-foreground rotate-90 md:rotate-0 flex-shrink-0" />

          <div className="flex-1">
            <Card className="p-6 bg-card border-border text-center">
              <div className="w-16 h-16 bg-secondary/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Sparkles className="h-7 w-7 text-secondary" />
              </div>
              <h3 className="font-semibold mb-2">Build</h3>
              <p className="text-sm text-muted-foreground">
                Create agentic workflows with the visual builder. Define what to
                build, how to verify, and what success looks like.
              </p>
            </Card>
          </div>

          <ArrowRight className="h-8 w-8 text-muted-foreground rotate-90 md:rotate-0 flex-shrink-0" />

          <div className="flex-1">
            <Card className="p-6 bg-card border-border text-center">
              <div className="w-16 h-16 bg-accent/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Bot className="h-7 w-7 text-accent" />
              </div>
              <h3 className="font-semibold mb-2">Run</h3>
              <p className="text-sm text-muted-foreground">
                AI executes in orchestrated phases, monitors for errors,
                verifies via UI Bridge and tests, and self-corrects.
              </p>
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
}
