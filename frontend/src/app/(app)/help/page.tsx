"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  HelpCircle,
  Rocket,
  BookOpen,
  Wrench,
  Settings,
  ExternalLink,
  Keyboard,
} from "lucide-react";

function SectionItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm text-text-secondary">
      <span className="mt-1.5 size-1.5 rounded-full bg-brand-primary/60 shrink-0" />
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
      <span className="text-sm text-text-secondary">{description}</span>
      <kbd className="px-2 py-0.5 text-xs font-mono rounded bg-surface-hover border border-border-subtle text-text-muted">
        {keys}
      </kbd>
    </div>
  );
}

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      <main className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <HelpCircle className="size-8 text-brand-primary" />
            <h2 className="text-3xl font-bold">Help &amp; Documentation</h2>
          </div>
          <p className="text-text-muted">Resources for using Qontinui</p>
        </div>

        {/* Cards Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Getting Started */}
          <Card className="bg-surface-raised/30 border-border-subtle/50 backdrop-blur-sm">
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
          <Card className="bg-surface-raised/30 border-border-subtle/50 backdrop-blur-sm">
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
          <Card className="bg-surface-raised/30 border-border-subtle/50 backdrop-blur-sm">
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
                <SectionItem>Shell Commands, API Requests, Scripts</SectionItem>
                <SectionItem>Contexts and Macros</SectionItem>
                <SectionItem>Scriptlets and Check Groups</SectionItem>
                <SectionItem>State Explorer</SectionItem>
              </ul>
            </CardContent>
          </Card>

          {/* Settings Reference */}
          <Card className="bg-surface-raised/30 border-border-subtle/50 backdrop-blur-sm">
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
          <Card className="bg-surface-raised/30 border-border-subtle/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ExternalLink className="size-5 text-brand-primary" />
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
                    className="flex items-center gap-2 text-sm text-text-secondary hover:text-brand-primary transition-colors"
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
                    className="flex items-center gap-2 text-sm text-text-secondary hover:text-brand-primary transition-colors"
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
                    className="flex items-center gap-2 text-sm text-text-secondary hover:text-brand-primary transition-colors"
                  >
                    <ExternalLink className="size-4 shrink-0" />
                    Report Issues
                  </a>
                </li>
              </ul>
            </CardContent>
          </Card>

          {/* Keyboard Shortcuts */}
          <Card className="bg-surface-raised/30 border-border-subtle/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Keyboard className="size-5 text-text-muted" />
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
