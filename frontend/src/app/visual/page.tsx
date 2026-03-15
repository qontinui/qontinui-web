"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight,
  Zap,
  Brain,
  Target,
  X,
  Check,
  LogIn,
  Github,
} from "lucide-react";
import Image from "next/image";
import { AuthDialog } from "@/components/auth-dialog";
import { useAuth } from "@/contexts/auth-context";
import { Footer } from "@/components/marketing/footer";

function VisualLandingContent() {
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [signupMode, setSignupMode] = useState(true);
  const { user } = useAuth();
  const router = useRouter();

  const handleGetStarted = () => {
    // Set product mode BEFORE opening auth dialog so the post-login
    // redirect (via /dashboard) routes to the visual dashboard
    localStorage.setItem("qontinui-product-mode", "visual");
    setSignupMode(true);
    setAuthDialogOpen(true);
  };

  const openSignIn = () => {
    localStorage.setItem("qontinui-product-mode", "visual");
    setSignupMode(false);
    setAuthDialogOpen(true);
  };

  const goToDashboard = () => {
    localStorage.setItem("qontinui-product-mode", "visual");
    router.push("/tools/visual-automation");
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
            <Badge
              variant="outline"
              className="ml-2 text-xs border-cyan-500/30 text-cyan-400"
            >
              Visual
            </Badge>
          </div>
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => router.push("/")}
              className="hover:bg-primary/10"
            >
              AI Development
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
            {user ? (
              <div className="flex items-center space-x-4">
                <span className="text-sm text-muted-foreground">
                  {user.email}
                </span>
                <Button
                  variant="outline"
                  onClick={goToDashboard}
                  className="border-primary/50 hover:border-primary hover:bg-primary/10"
                >
                  Visual Dashboard
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                onClick={openSignIn}
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
          <Badge className="mb-6 bg-accent/20 text-accent border-accent/30 glow-green">
            Free &amp; Open Source
          </Badge>

          <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold mb-6 text-balance">
            GUI Automation That{" "}
            <span className="text-primary">Thinks Like You Do</span>
          </h1>

          <p className="text-xl md:text-2xl text-muted-foreground mb-8 max-w-3xl mx-auto text-pretty">
            Model-based GUI automation that adapts to unexpected changes instead
            of breaking. Built on peer-reviewed research.
          </p>

          <Button
            size="lg"
            onClick={handleGetStarted}
            className="bg-primary text-primary-foreground hover:bg-primary/90 glow-cyan pulse-cyan text-lg px-8 py-4"
          >
            Get Started Free
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </section>

      {/* Key Benefits */}
      <section className="py-20 px-4">
        <div className="container mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-16">
            Why Qontinui Changes Everything
          </h2>

          <div className="grid md:grid-cols-3 gap-8">
            <Card className="p-8 bg-card border-border hover:border-primary/50 transition-all duration-300 group hover:glow-cyan">
              <div className="mb-6">
                <div className="w-12 h-12 bg-primary/20 rounded-lg flex items-center justify-center group-hover:glow-cyan transition-all duration-300">
                  <Brain className="h-6 w-6 text-primary" />
                </div>
              </div>
              <h3 className="text-xl font-semibold mb-4">
                Robust Against Changes
              </h3>
              <p className="text-muted-foreground">
                Unlike traditional scripting that breaks when UI changes,
                Qontinui adapts in real-time &mdash; just like a human would.
              </p>
            </Card>

            <Card className="p-8 bg-card border-border hover:border-secondary/50 transition-all duration-300 group hover:glow-purple">
              <div className="mb-6">
                <div className="w-12 h-12 bg-secondary/20 rounded-lg flex items-center justify-center group-hover:glow-purple transition-all duration-300">
                  <Target className="h-6 w-6 text-secondary" />
                </div>
              </div>
              <h3 className="text-xl font-semibold mb-4">
                Handles Complex Tasks
              </h3>
              <p className="text-muted-foreground">
                Navigate complex workflows with multiple paths and unexpected
                scenarios &mdash; from simple clicks to entire business
                processes.
              </p>
            </Card>

            <Card className="p-8 bg-card border-border hover:border-accent/50 transition-all duration-300 group hover:glow-green">
              <div className="mb-6">
                <div className="w-12 h-12 bg-accent/20 rounded-lg flex items-center justify-center group-hover:glow-green transition-all duration-300">
                  <Zap className="h-6 w-6 text-accent" />
                </div>
              </div>
              <h3 className="text-xl font-semibold mb-4">
                Continuous, Not Discrete
              </h3>
              <p className="text-muted-foreground">
                Works like you do &mdash; continuously adapting to the current
                state rather than following rigid scripts that fail at the first
                obstacle.
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section className="py-20 px-4 bg-muted/20">
        <div className="container mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-16">
            Beyond Traditional Automation
          </h2>

          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            <Card className="p-8 bg-card/50 border-destructive/30 opacity-75">
              <h3 className="text-xl font-semibold mb-6 text-destructive flex items-center">
                <X className="h-5 w-5 mr-2" />
                Traditional Automation
              </h3>
              <ul className="space-y-3 text-muted-foreground">
                <li>Fixed scripts that break easily</li>
                <li>Exponential complexity with UI changes</li>
                <li>Requires constant maintenance</li>
                <li>Fails at unexpected scenarios</li>
                <li>Brittle and unreliable</li>
              </ul>
            </Card>

            <Card className="p-8 bg-card border-primary/30 glow-cyan">
              <h3 className="text-xl font-semibold mb-6 text-primary flex items-center">
                <Check className="h-5 w-5 mr-2" />
                Qontinui Automation
              </h3>
              <ul className="space-y-3">
                <li>Adaptive pathfinding technology</li>
                <li>Self-healing automation flows</li>
                <li>Scales with your application</li>
                <li>Handles unexpected changes gracefully</li>
                <li>Robust and reliable by design</li>
              </ul>
            </Card>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-4">
        <div className="container mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-16">
            How It Works
          </h2>

          <div className="max-w-4xl mx-auto">
            <div className="flex flex-col md:flex-row items-center justify-between space-y-8 md:space-y-0 md:space-x-8">
              <div className="flex-1">
                <Card className="p-6 bg-card border-border text-center">
                  <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-2xl font-bold text-primary">1</span>
                  </div>
                  <h3 className="font-semibold mb-2">Observe State</h3>
                  <p className="text-sm text-muted-foreground">
                    Continuously monitors the current UI state
                  </p>
                </Card>
              </div>

              <ArrowRight className="h-8 w-8 text-secondary rotate-90 md:rotate-0" />

              <div className="flex-1">
                <Card className="p-6 bg-card border-border text-center">
                  <div className="w-16 h-16 bg-secondary/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-2xl font-bold text-secondary">2</span>
                  </div>
                  <h3 className="font-semibold mb-2">Adapt Path</h3>
                  <p className="text-sm text-muted-foreground">
                    Dynamically adjusts approach based on changes
                  </p>
                </Card>
              </div>

              <ArrowRight className="h-8 w-8 text-secondary rotate-90 md:rotate-0" />

              <div className="flex-1">
                <Card className="p-6 bg-card border-border text-center">
                  <div className="w-16 h-16 bg-accent/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-2xl font-bold text-accent">3</span>
                  </div>
                  <h3 className="font-semibold mb-2">Execute Action</h3>
                  <p className="text-sm text-muted-foreground">
                    Performs the optimal action for current state
                  </p>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Research & Open Source */}
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

          <div className="grid md:grid-cols-2 gap-8 mb-8">
            <Card className="p-8 bg-card border-border hover:border-primary/50 transition-all duration-300">
              <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Brain className="h-6 w-6 text-primary" />
                Peer-Reviewed Foundation
              </h3>
              <p className="text-muted-foreground mb-6">
                Published in Springer SoSyM &mdash; the first
                mathematically-proven approach to GUI automation that reduces
                complexity from exponential to polynomial growth.
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
              <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Zap className="h-6 w-6 text-primary" />
                Open Source
              </h3>
              <p className="text-muted-foreground mb-6">
                All core libraries are open source. The qontinui Python library,
                multistate framework, runner, and API bridge are freely available
                on GitHub.
              </p>
              <div className="space-y-2">
                <a
                  href="https://github.com/qontinui/qontinui"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-primary hover:underline"
                >
                  GitHub: qontinui (Python)
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

          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              <code className="bg-muted px-2 py-1 rounded">
                pip install qontinui
              </code>{" "}
              to get started with the open-source library
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4">
        <div className="container mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to Try It?</h2>
          <p className="text-muted-foreground mb-8">
            Start building intelligent, adaptive GUI automation today &mdash;
            completely free.
          </p>
          <Button
            size="lg"
            onClick={handleGetStarted}
            className="bg-primary text-primary-foreground hover:bg-primary/90 glow-cyan pulse-cyan text-lg px-8 py-4"
          >
            Get Started Free
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </section>

      {/* Auth Dialog */}
      <AuthDialog
        open={authDialogOpen}
        onOpenChange={setAuthDialogOpen}
        defaultTab={signupMode ? "signup" : "signin"}
      />

      <Footer />
    </div>
  );
}

export default function VisualLandingPage() {
  return <VisualLandingContent />;
}
