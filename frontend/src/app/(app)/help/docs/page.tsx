"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Rocket,
  BookOpen,
  Wrench,
  Settings,
  ExternalLink,
  Keyboard,
} from "lucide-react";

function SectionItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm text-muted-foreground">
      <span className="mt-1.5 size-1.5 rounded-full bg-primary/60 shrink-0" />
      <span>{children}</span>
    </li>
  );
}

function ShortcutRow({
  keys,
  description,
}: {
  keys: string;
  description: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{description}</span>
      <kbd className="px-2 py-0.5 text-xs font-mono rounded bg-muted border border-border text-muted-foreground">
        {keys}
      </kbd>
    </div>
  );
}

export default function HelpPage() {
  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">Help &amp; Documentation</h1>
        <span className="text-sm text-muted-foreground">
          Resources for using Qontinui
        </span>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        {/* Cards Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Getting Started */}
          <Card className="bg-background border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Rocket className="size-5 text-green-400" />
                Getting Started
              </CardTitle>
              <CardDescription>
                First steps to get up and running
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                <SectionItem>Connect your desktop runner</SectionItem>
                <SectionItem>Create your first workflow</SectionItem>
                <SectionItem>Understanding the automation pipeline</SectionItem>
              </ul>
            </CardContent>
          </Card>

          {/* Key Concepts */}
          <Card className="bg-background border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="size-5 text-blue-400" />
                Key Concepts
              </CardTitle>
              <CardDescription>
                Core ideas behind Qontinui automation
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                <SectionItem>Model-based GUI automation</SectionItem>
                <SectionItem>States, transitions, and paths</SectionItem>
                <SectionItem>
                  Workflows and phases (setup, verification, agentic,
                  completion)
                </SectionItem>
                <SectionItem>Findings and knowledge</SectionItem>
              </ul>
            </CardContent>
          </Card>

          {/* Builder Reference */}
          <Card className="bg-background border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Wrench className="size-5 text-amber-400" />
                Builder Reference
              </CardTitle>
              <CardDescription>
                Asset types available in the workflow builder
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                <SectionItem>Workflows</SectionItem>
                <SectionItem>Tests and Checks</SectionItem>
                <SectionItem>
                  Shell Commands, API Requests, Playwright Tests
                </SectionItem>
                <SectionItem>Contexts and Macros</SectionItem>
                <SectionItem>Prompt Snippets and Check Groups</SectionItem>
                <SectionItem>State Explorer</SectionItem>
              </ul>
            </CardContent>
          </Card>

          {/* Settings Reference */}
          <Card className="bg-background border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Settings className="size-5 text-purple-400" />
                Settings Reference
              </CardTitle>
              <CardDescription>
                Configuration options for the runner
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                <SectionItem>AI Providers and Advanced AI</SectionItem>
                <SectionItem>Self-Healing</SectionItem>
                <SectionItem>Playwright</SectionItem>
                <SectionItem>MCP Servers</SectionItem>
                <SectionItem>Log Sources and Storage</SectionItem>
                <SectionItem>Backup</SectionItem>
              </ul>
            </CardContent>
          </Card>

          {/* Resources */}
          <Card className="bg-background border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ExternalLink className="size-5 text-primary" />
                Resources
              </CardTitle>
              <CardDescription>External links and references</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                <li>
                  <a
                    href="https://github.com/qontinui/qontinui"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ExternalLink className="size-4 shrink-0" />
                    GitHub Repository (qontinui/qontinui)
                  </a>
                </li>
                <li>
                  <a
                    href="https://qontinui.github.io/multistate/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ExternalLink className="size-4 shrink-0" />
                    Documentation Site
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/qontinui/qontinui/issues"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ExternalLink className="size-4 shrink-0" />
                    Report Issues
                  </a>
                </li>
              </ul>
            </CardContent>
          </Card>

          {/* Keyboard Shortcuts */}
          <Card className="bg-background border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Keyboard className="size-5 text-muted-foreground" />
                Keyboard Shortcuts
              </CardTitle>
              <CardDescription>
                Common shortcuts for quick navigation
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                <ShortcutRow keys="Ctrl + K" description="Command palette" />
                <ShortcutRow keys="Ctrl + S" description="Save current item" />
                <ShortcutRow keys="Ctrl + N" description="New workflow" />
                <ShortcutRow keys="Ctrl + Enter" description="Run / Execute" />
                <ShortcutRow keys="Escape" description="Close dialog" />
                <ShortcutRow keys="Ctrl + /" description="Toggle sidebar" />
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
