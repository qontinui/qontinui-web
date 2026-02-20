"use client";

import type React from "react";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight,
  X,
  Check,
  LogIn,
  Download,
  Github,
  Sparkles,
  ShieldCheck,
  AlertCircle,
  Puzzle,
  BookOpen,
  TestTube,
  Monitor,
  Layers,
  Cpu,
  Chrome,
  Bot,
  Settings,
} from "lucide-react";
import Image from "next/image";
import { AuthDialog } from "@/components/auth-dialog";
import { AuthProvider, useAuth } from "@/contexts/auth-context";
import { Footer } from "@/components/marketing/footer";

type Platform = "windows" | "macos" | "linux" | "unknown";

function detectPlatform(): Platform {
  if (typeof window === "undefined") return "unknown";
  const userAgent = window.navigator.userAgent.toLowerCase();
  if (userAgent.includes("win")) return "windows";
  if (userAgent.includes("mac")) return "macos";
  if (userAgent.includes("linux")) return "linux";
  return "unknown";
}

function getDownloadLabel(platform: Platform): string {
  switch (platform) {
    case "windows":
      return "Download for Windows";
    case "macos":
      return "Download for macOS";
    case "linux":
      return "Download for Linux";
    default:
      return "Download";
  }
}

function LandingContent() {
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [signupMode, setSignupMode] = useState(true);
  const [platform, setPlatform] = useState<Platform>("unknown");
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  const handleDownload = () => {
    if (platform === "windows") {
      window.location.href =
        "https://github.com/qontinui/qontinui-runner/releases/tag/v1.0.0-beta.1";
    } else {
      router.push("/runner/download");
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="fixed top-0 w-full z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div
            className="flex items-center gap-1 cursor-pointer"
            onClick={() => router.push("/")}
          >
            <Image
              src="/q-logo.png"
              alt="Qontinui"
              width={32}
              height={32}
              className="h-8 w-auto"
            />
            <span className="text-2xl font-bold text-primary">ontinui</span>
          </div>
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => router.push("/docs")}
              className="hover:bg-primary/10"
            >
              Docs
            </Button>
            <a
              href="https://github.com/qontinui"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="ghost" className="hover:bg-primary/10">
                <Github className="mr-2 h-4 w-4" />
                GitHub
              </Button>
            </a>
            <Button
              onClick={() => router.push("/runner/download")}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Download className="mr-2 h-4 w-4" />
              Download
            </Button>
            {user ? (
              <div className="flex items-center space-x-4">
                <span className="text-sm text-muted-foreground">
                  {user.email}
                </span>
                <Button
                  variant="outline"
                  onClick={() => router.push("/build/workflows")}
                  className="border-primary/50 hover:border-primary hover:bg-primary/10"
                >
                  Dashboard
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                onClick={() => {
                  setSignupMode(false);
                  setAuthDialogOpen(true);
                }}
                className="hover:bg-primary/10"
              >
                <LogIn className="mr-2 h-4 w-4" />
                Sign In
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
        <div className="absolute inset-0 dot-grid animate-pulse" />
        <div className="container mx-auto px-4 text-center relative z-10">
          <Badge className="mb-6 bg-green-500/20 text-green-300 border-green-500/30">
            Free & Open Source
          </Badge>

          <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold mb-6 text-balance">
            AI Development That{" "}
            <span className="text-primary">Verifies Its Own Work</span>
          </h1>

          <p className="text-xl md:text-2xl text-muted-foreground mb-8 max-w-3xl mx-auto text-pretty">
            An open-source desktop app that orchestrates AI coding sessions with
            verification loops, error monitoring, and visual feedback. Bring
            your own AI provider — no vendor lock-in.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Button
              size="lg"
              onClick={handleDownload}
              className="bg-primary text-primary-foreground hover:bg-primary/90 glow-cyan pulse-cyan text-lg px-8 py-4"
            >
              <Download className="mr-2 h-5 w-5" />
              {getDownloadLabel(platform)}
            </Button>
            <a
              href="https://github.com/qontinui/qontinui-runner"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button
                size="lg"
                variant="outline"
                className="text-lg px-8 py-4 border-primary/30 hover:border-primary hover:bg-primary/10"
              >
                <Github className="mr-2 h-5 w-5" />
                View on GitHub
              </Button>
            </a>
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            Also available: macOS (coming soon) | Linux (coming soon) |{" "}
            <a
              href="https://github.com/qontinui/qontinui-runner#installation"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Build from source
            </a>
          </p>
        </div>
      </section>

      {/* UI Bridge Section */}
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
              application&apos;s React component tree. It sees what your users
              see — and more.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <Card className="p-8 bg-card border-border hover:border-primary/50 transition-all duration-300 group">
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

            <Card className="p-8 bg-card border-border hover:border-secondary/50 transition-all duration-300 group">
              <div className="mb-4">
                <div className="w-12 h-12 bg-secondary/20 rounded-lg flex items-center justify-center">
                  <Monitor className="h-6 w-6 text-secondary" />
                </div>
              </div>
              <h3 className="text-lg font-semibold mb-2">Cross-Platform</h3>
              <p className="text-muted-foreground text-sm">
                Works on websites, desktop apps, and mobile apps. One tool for
                all your React frontends.
              </p>
            </Card>

            <Card className="p-8 bg-card border-border hover:border-accent/50 transition-all duration-300 group">
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

            <Card className="p-8 bg-card border-border hover:border-primary/50 transition-all duration-300 group">
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

            <Card className="p-8 bg-card border-border hover:border-secondary/50 transition-all duration-300 group">
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

            <Card className="p-8 bg-card border-border hover:border-accent/50 transition-all duration-300 group">
              <div className="mb-4">
                <div className="w-12 h-12 bg-accent/20 rounded-lg flex items-center justify-center">
                  <Bot className="h-6 w-6 text-accent" />
                </div>
              </div>
              <h3 className="text-lg font-semibold mb-2">
                AI-Powered Feedback
              </h3>
              <p className="text-muted-foreground text-sm">
                AI agents use UI Bridge to verify their changes actually work —
                they see the real application, not just code.
              </p>
            </Card>
          </div>

          <p className="text-center text-sm text-muted-foreground mt-8">
            Build, execute, and monitor AI development workflows from your
            browser
          </p>
        </div>
      </section>

      {/* Provider Independence Section */}
      <section className="py-20 px-4 bg-muted/20">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Your AI, Your Rules
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Bring your own API key. No subscriptions to third parties. No
              unauthorized access. Just direct, compliant integration with the
              providers you choose.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <Card className="p-8 bg-card border-border hover:border-primary/50 transition-all duration-300 hover:glow-cyan">
              <h3 className="text-xl font-semibold mb-3">Claude</h3>
              <p className="text-muted-foreground text-sm">
                Claude Code CLI or API key. Use your subscription or
                pay-per-token.
              </p>
            </Card>

            <Card className="p-8 bg-card border-border hover:border-secondary/50 transition-all duration-300 hover:glow-purple">
              <h3 className="text-xl font-semibold mb-3">Gemini</h3>
              <p className="text-muted-foreground text-sm">
                Gemini CLI with OAuth or API key. Free tier available.
              </p>
            </Card>

            <Card className="p-8 bg-card border-border hover:border-accent/50 transition-all duration-300 hover:glow-green">
              <h3 className="text-xl font-semibold mb-3">More Coming</h3>
              <p className="text-muted-foreground text-sm">
                Open architecture. Adding new providers is straightforward.
              </p>
            </Card>
          </div>

          <p className="text-center text-muted-foreground mt-8">
            Switch providers without changing your workflows. Your automations
            aren&apos;t locked to any single vendor.
          </p>
        </div>
      </section>

      {/* Key Features Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto max-w-6xl">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-16">
            Built for AI-Assisted Development
          </h2>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <FeatureCard
              icon={<Sparkles className="h-6 w-6 text-primary" />}
              title="Orchestrated Workflows"
              description="Multi-phase AI sessions with setup, agentic, verification, and completion stages. Not just a chat interface."
              color="primary"
            />
            <FeatureCard
              icon={<ShieldCheck className="h-6 w-6 text-secondary" />}
              title="Self-Correcting AI"
              description="Verification loops catch mistakes automatically. AI checks its own work before moving on."
              color="secondary"
            />
            <FeatureCard
              icon={<AlertCircle className="h-6 w-6 text-accent" />}
              title="Error Monitoring"
              description="Watches your application logs in real-time. Detects errors and triggers AI to fix them automatically."
              color="accent"
            />
            <FeatureCard
              icon={<Puzzle className="h-6 w-6 text-primary" />}
              title="UI Bridge Feedback"
              description="AI sees your running application through deep React inspection. Verifies changes visually, not just syntactically."
              color="primary"
            />
            <FeatureCard
              icon={<BookOpen className="h-6 w-6 text-secondary" />}
              title="Persistent Knowledge"
              description="AI builds knowledge across sessions. Findings, contexts, and patterns persist and compound over time."
              color="secondary"
            />
            <FeatureCard
              icon={<TestTube className="h-6 w-6 text-accent" />}
              title="Test Verification"
              description="Built-in Playwright and UI Bridge testing. AI writes and runs tests to verify its changes work."
              color="accent"
            />
          </div>
        </div>
      </section>

      {/* How It Works */}
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
                  Choose your AI provider and connect to your project. Set up
                  log sources so AI can monitor your application.
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
                  Create agentic workflows with the visual builder. Define what
                  to build, how to verify, and what success looks like.
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

      {/* Comparison Section */}
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

      {/* Research & Open Source Section */}
      <section className="py-20 px-4 bg-muted/20">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">
              Peer-Reviewed Research
            </Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Built on Published Science, Open to Everyone
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Based on peer-reviewed research published in Springer&apos;s
              Software and Systems Modeling journal (2025).
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <Card className="p-8 bg-card border-border hover:border-primary/50 transition-all duration-300">
              <h3 className="text-xl font-semibold mb-4">
                Peer-Reviewed Foundation
              </h3>
              <p className="text-muted-foreground mb-6">
                Published in Springer SoSyM — the first mathematically-proven
                approach to GUI automation that reduces complexity from
                exponential to polynomial growth.
              </p>
              <a
                href="https://link.springer.com/article/10.1007/s10270-025-01319-9"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-primary hover:underline"
              >
                Read the Paper
                <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </Card>

            <Card className="p-8 bg-card border-border hover:border-primary/50 transition-all duration-300">
              <h3 className="text-xl font-semibold mb-4">Open Source</h3>
              <p className="text-muted-foreground mb-6">
                The runner, UI bridge, multistate framework, and core libraries
                are freely available on GitHub. Contribute, fork, or build on
                top.
              </p>
              <div className="space-y-2">
                <a
                  href="https://github.com/qontinui/qontinui-runner"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-primary hover:underline"
                >
                  GitHub: qontinui-runner
                </a>
                <a
                  href="https://github.com/qontinui/ui-bridge"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-primary hover:underline"
                >
                  GitHub: ui-bridge
                </a>
                <a
                  href="https://qontinui.github.io/multistate/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-primary hover:underline"
                >
                  Docs: multistate (state machine)
                </a>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* Download CTA Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to Try It?</h2>
          <p className="text-muted-foreground mb-8">
            Download Qontinui Runner and start building AI-assisted development
            workflows today.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Button
              size="lg"
              onClick={handleDownload}
              className="bg-primary text-primary-foreground hover:bg-primary/90 glow-cyan pulse-cyan text-lg px-8 py-4"
            >
              <Download className="mr-2 h-5 w-5" />
              {getDownloadLabel(platform)}
            </Button>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            <a href="/runner/download" className="text-primary hover:underline">
              All download options
            </a>{" "}
            | Windows 10+, 64-bit, 200 MB disk space
          </p>
        </div>
      </section>

      {/* Auth Dialog */}
      <AuthDialog
        open={authDialogOpen}
        onOpenChange={setAuthDialogOpen}
        defaultTab={signupMode ? "signup" : "signin"}
      />

      {/* Footer */}
      <Footer />
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  color,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  color: "primary" | "secondary" | "accent";
}) {
  const glowClass =
    color === "primary"
      ? "hover:glow-cyan"
      : color === "secondary"
        ? "hover:glow-purple"
        : "hover:glow-green";
  const borderClass =
    color === "primary"
      ? "hover:border-primary/50"
      : color === "secondary"
        ? "hover:border-secondary/50"
        : "hover:border-accent/50";
  const bgClass =
    color === "primary"
      ? "bg-primary/20"
      : color === "secondary"
        ? "bg-secondary/20"
        : "bg-accent/20";

  return (
    <Card
      className={`p-8 bg-card border-border ${borderClass} transition-all duration-300 group ${glowClass}`}
    >
      <div className="mb-6">
        <div
          className={`w-12 h-12 ${bgClass} rounded-lg flex items-center justify-center transition-all duration-300`}
        >
          {icon}
        </div>
      </div>
      <h3 className="text-xl font-semibold mb-4">{title}</h3>
      <p className="text-muted-foreground">{description}</p>
    </Card>
  );
}

export default function QontinuiLanding() {
  return (
    <AuthProvider>
      <LandingContent />
    </AuthProvider>
  );
}
