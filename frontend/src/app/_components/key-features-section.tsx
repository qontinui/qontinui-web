"use client";

import React from "react";
import {
  Sparkles,
  ShieldCheck,
  AlertCircle,
  Puzzle,
  BookOpen,
  TestTube,
} from "lucide-react";
import { FeatureCard } from "./feature-card";

export function KeyFeaturesSection() {
  return (
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
  );
}
