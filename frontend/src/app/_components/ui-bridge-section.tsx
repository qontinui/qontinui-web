"use client";

import React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Layers, Monitor, Cpu, Puzzle, Chrome, Bot } from "lucide-react";

export function UIBridgeSection() {
  return (
    <section className="py-20 px-4">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-16">
          <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">
            Deeply Differentiating
          </Badge>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Deep Application Awareness Through UI Bridge
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Unlike screen scrapers or DOM parsers, UI Bridge understands your
            application&apos;s React component tree. It sees what your users see
            — and more.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          <Card className="p-8 bg-card border-border">
            <div className="mb-4">
              <div className="w-12 h-12 bg-primary/20 rounded-lg flex items-center justify-center">
                <Layers className="h-6 w-6 text-primary" />
              </div>
            </div>
            <h3 className="text-lg font-semibold mb-2">
              React Component Inspection
            </h3>
            <p className="text-muted-foreground text-sm">
              Inspects component props, state, and hierarchy across any React
              app — Next.js, Tauri, React Native.
            </p>
          </Card>

          <Card className="p-8 bg-card border-border">
            <div className="mb-4">
              <div className="w-12 h-12 bg-secondary/20 rounded-lg flex items-center justify-center">
                <Monitor className="h-6 w-6 text-secondary" />
              </div>
            </div>
            <h3 className="text-lg font-semibold mb-2">Cross-Platform</h3>
            <p className="text-muted-foreground text-sm">
              Works on websites, desktop apps, and mobile apps. One tool for all
              your React frontends.
            </p>
          </Card>

          <Card className="p-8 bg-card border-border">
            <div className="mb-4">
              <div className="w-12 h-12 bg-accent/20 rounded-lg flex items-center justify-center">
                <Cpu className="h-6 w-6 text-accent" />
              </div>
            </div>
            <h3 className="text-lg font-semibold mb-2">
              Automation & Interaction
            </h3>
            <p className="text-muted-foreground text-sm">
              Click, type, and interact with elements programmatically. Faster
              and more reliable than pixel-based approaches.
            </p>
          </Card>

          <Card className="p-8 bg-card border-border">
            <div className="mb-4">
              <div className="w-12 h-12 bg-primary/20 rounded-lg flex items-center justify-center">
                <Puzzle className="h-6 w-6 text-primary" />
              </div>
            </div>
            <h3 className="text-lg font-semibold mb-2">
              State Machine Integration
            </h3>
            <p className="text-muted-foreground text-sm">
              Model your application&apos;s states and transitions. Based on
              peer-reviewed research in model-based GUI automation.
            </p>
          </Card>

          <Card className="p-8 bg-card border-border">
            <div className="mb-4">
              <div className="w-12 h-12 bg-secondary/20 rounded-lg flex items-center justify-center">
                <Chrome className="h-6 w-6 text-secondary" />
              </div>
            </div>
            <h3 className="text-lg font-semibold mb-2">Chrome Extension</h3>
            <p className="text-muted-foreground text-sm">
              Lightweight extension for element discovery and screenshots in
              external browser tabs.
            </p>
          </Card>

          <Card className="p-8 bg-card border-border">
            <div className="mb-4">
              <div className="w-12 h-12 bg-accent/20 rounded-lg flex items-center justify-center">
                <Bot className="h-6 w-6 text-accent" />
              </div>
            </div>
            <h3 className="text-lg font-semibold mb-2">AI-Powered Feedback</h3>
            <p className="text-muted-foreground text-sm">
              AI agents use UI Bridge to verify their changes actually work —
              they see the real application, not just code.
            </p>
          </Card>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-8">
          Build, execute, and monitor AI development workflows from your browser
        </p>
      </div>
    </section>
  );
}
