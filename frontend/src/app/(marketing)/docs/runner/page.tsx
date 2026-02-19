import Link from "next/link";
import { Download } from "lucide-react";

export const metadata = {
  title: "Qontinui Runner Documentation - AI Development Desktop App",
  description:
    "Complete guide to using Qontinui Runner to orchestrate AI coding sessions with verification loops, error monitoring, and workflow automation.",
};

export default function RunnerDocsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {/* Header */}
        <div className="mb-12">
          <Link
            href="/docs"
            className="text-primary hover:text-primary/80 text-sm mb-4 inline-block"
          >
            ← Back to Documentation
          </Link>
          <h1 className="text-4xl font-bold text-foreground mb-4">
            Qontinui Runner
          </h1>
          <p className="text-xl text-muted-foreground">
            Desktop application for orchestrating AI coding sessions with
            automated feedback loops
          </p>
        </div>

        {/* What is Runner */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            What is Qontinui Runner?
          </h2>
          <p className="text-foreground mb-4">
            Qontinui Runner is a desktop application that orchestrates AI coding
            sessions with automated feedback loops. It provides:
          </p>
          <ul className="space-y-2 text-foreground">
            <li className="flex items-start gap-2">
              <span className="text-green-600 font-bold">✓</span>
              <span>Actual mouse clicks and keyboard input</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-600 font-bold">✓</span>
              <span>Real image recognition using OpenCV</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-600 font-bold">✓</span>
              <span>Multi-monitor support</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-600 font-bold">✓</span>
              <span>Live execution monitoring and logs</span>
            </li>
          </ul>

          <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 mt-6">
            <p className="text-sm text-foreground">
              <strong>Note:</strong> For testing automation logic without real
              GUI interactions, use{" "}
              <Link href="/docs/web/testing" className="underline">
                Mock Execution in Qontinui Web
              </Link>
              .
            </p>
          </div>
        </section>

        {/* Quick Links */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Documentation Sections
          </h2>
          <div className="grid gap-4">
            <DocLink
              title="Installation"
              description="Download and install Qontinui Runner on Windows, macOS, or Linux"
              href="/docs/runner/installation"
            />
            <DocLink
              title="Running Automations"
              description="Load configurations and execute automation workflows"
              href="/docs/runner/execution"
            />
            <DocLink
              title="Monitoring & Logs"
              description="Track execution progress and debug issues"
              href="/docs/runner/monitoring"
            />
            <DocLink
              title="Multi-Monitor Setup"
              description="Configure Runner to target specific displays"
              href="/docs/runner/multi-monitor"
            />
            <DocLink
              title="Findings & Knowledge"
              description="Understand how the runner tracks issues and accumulates cross-iteration context"
              href="/docs/runner/findings-and-knowledge"
            />
            <DocLink
              title="Troubleshooting"
              description="Common issues and solutions"
              href="/docs/runner/troubleshooting"
            />
          </div>
        </section>

        {/* System Requirements */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            System Requirements
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            <SystemReq
              platform="Windows"
              requirements={[
                "Windows 10 or later (64-bit)",
                "4GB RAM minimum",
                "Python 3.10+ (auto-installed)",
                "Active display (not headless)",
              ]}
            />
            <SystemReq
              platform="macOS"
              requirements={[
                "macOS 11 (Big Sur) or later",
                "Apple Silicon or Intel",
                "4GB RAM minimum",
                "Python 3.10+ (auto-installed)",
              ]}
            />
            <SystemReq
              platform="Linux"
              requirements={[
                "Ubuntu 20.04+ or equivalent",
                "X11 or Wayland display server",
                "4GB RAM minimum",
                "Python 3.10+ required",
              ]}
            />
          </div>
        </section>

        {/* Key Features */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Key Features
          </h2>
          <div className="space-y-6">
            <FeatureSection
              title="Visual Execution Monitoring"
              description="Watch your automation execute in real-time with a visual representation of state transitions, action execution, and image recognition results."
            />
            <FeatureSection
              title="Comprehensive Logging"
              description="Detailed logs for every action, state transition, and image recognition attempt. Export logs for debugging or compliance purposes."
            />
            <FeatureSection
              title="Multi-Monitor Support"
              description="Target specific monitors for automation execution. Perfect for multi-display setups where you want automation on one screen while working on another."
            />
            <FeatureSection
              title="Graceful Error Handling"
              description="Configure how Runner responds to errors: stop immediately, retry with backoff, or continue with the next action based on your preferences."
            />
          </div>
        </section>

        {/* Getting Started CTA */}
        <section className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-8">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Ready to Get Started?
          </h2>
          <p className="text-foreground mb-6">
            Download Qontinui Runner and start running your automation workflows
            today.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link
              href="/runner/download"
              className="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
            >
              <Download className="w-5 h-5" />
              Download Runner
            </Link>
            <Link
              href="/docs/runner/installation"
              className="inline-flex items-center gap-2 bg-background hover:bg-muted text-foreground border border-border px-6 py-3 rounded-lg font-semibold transition-colors"
            >
              Installation Guide →
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

interface DocLinkProps {
  title: string;
  description: string;
  href: string;
}

function DocLink({ title, description, href }: DocLinkProps) {
  return (
    <Link
      href={href}
      className="block bg-card border border-border rounded-lg p-6 hover:shadow-md hover:border-primary/50 transition-all"
    >
      <h3 className="font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </Link>
  );
}

interface SystemReqProps {
  platform: string;
  requirements: string[];
}

function SystemReq({ platform, requirements }: SystemReqProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h3 className="font-bold text-foreground mb-4">{platform}</h3>
      <ul className="space-y-2">
        {requirements.map((req, idx) => (
          <li
            key={idx}
            className="text-sm text-foreground flex items-start gap-2"
          >
            <span className="text-green-600 mt-0.5">•</span>
            <span>{req}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface FeatureSectionProps {
  title: string;
  description: string;
}

function FeatureSection({ title, description }: FeatureSectionProps) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-foreground">{description}</p>
    </div>
  );
}
