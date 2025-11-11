import Link from "next/link";
import { Download, Globe, Play, CheckCircle } from "lucide-react";

export const metadata = {
  title: "Getting Started with Qontinui - Quick Start Guide",
  description:
    "Learn how to create your first GUI automation workflow with Qontinui in just a few minutes.",
};

export default function GettingStartedPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {/* Header */}
        <div className="mb-12">
          <Link
            href="/docs"
            className="text-primary hover:underline text-sm mb-4 inline-block"
          >
            ← Back to Documentation
          </Link>
          <h1 className="text-4xl font-bold mb-4">
            Getting Started
          </h1>
          <p className="text-xl text-muted-foreground">
            Create your first GUI automation workflow in 3 simple steps
          </p>
        </div>

        {/* Overview */}
        <section className="mb-12">
          <div className="bg-primary/10 border border-primary/30 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-3">
              What You'll Learn
            </h2>
            <ul className="space-y-2">
              <li className="flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <span className="text-muted-foreground">
                  How to build automation workflows in Qontinui Web
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <span className="text-muted-foreground">
                  How to test your automation with mock execution
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <span className="text-muted-foreground">
                  How to run your automation with Qontinui Runner
                </span>
              </li>
            </ul>
          </div>
        </section>

        {/* Step 1: Build in Web */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold text-lg">
              1
            </div>
            <h2 className="text-2xl font-bold">
              Build Your Automation in Qontinui Web
            </h2>
          </div>

          <div className="pl-13 space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-3">
                Create a Free Account
              </h3>
              <p className="text-muted-foreground mb-4">
                Visit{" "}
                <Link
                  href="https://qontinui.com"
                  className="text-primary hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  qontinui.com
                </Link>{" "}
                and sign up for a free account. No credit card required.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-3">
                Create Your First Project
              </h3>
              <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                <li>Click "New Project" in your dashboard</li>
                <li>Give your project a name (e.g., "My First Automation")</li>
                <li>Click "Create" to open the automation builder</li>
              </ol>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-3">
                Define Your States
              </h3>
              <p className="text-muted-foreground mb-3">
                States represent the different screens or conditions in your application. For example:
              </p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-4">
                <li>Login Screen</li>
                <li>Dashboard</li>
                <li>Settings Page</li>
              </ul>
              <p className="text-muted-foreground text-sm mt-3">
                <strong>Tip:</strong> Add identifying images to each state so Qontinui can recognize when it's active.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-3">
                Add Actions and Transitions
              </h3>
              <p className="text-muted-foreground mb-3">
                Connect your states with transitions that define:
              </p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-4">
                <li>What actions to perform (click, type, wait, etc.)</li>
                <li>Which state to navigate to next</li>
                <li>When the transition should occur</li>
              </ul>
            </div>

            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-sm text-muted-foreground">
                <strong>Learn More:</strong>{" "}
                <Link href="/docs/web/states" className="text-primary hover:underline">
                  Working with States
                </Link>
                {" • "}
                <Link href="/docs/web/actions" className="text-primary hover:underline">
                  Action Types
                </Link>
                {" • "}
                <Link href="/docs/web/transitions" className="text-primary hover:underline">
                  State Transitions
                </Link>
              </p>
            </div>
          </div>
        </section>

        {/* Step 2: Test with Mock Execution */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-accent text-accent-foreground rounded-full flex items-center justify-center font-bold text-lg">
              2
            </div>
            <h2 className="text-2xl font-bold">
              Test with Mock Execution
            </h2>
          </div>

          <div className="pl-13 space-y-4">
            <p className="text-muted-foreground">
              Before running on real systems, test your automation logic directly in the browser:
            </p>
            <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
              <li>Click the "Test" button in the automation builder</li>
              <li>Select your starting process or state</li>
              <li>Watch as Qontinui simulates the execution flow</li>
              <li>Review the execution log to verify your logic</li>
            </ol>
            <div className="bg-accent/10 border border-accent/30 rounded-lg p-4 mt-4">
              <p className="text-sm">
                <strong>Why Mock Testing?</strong> Mock execution lets you validate your state machine
                and automation logic without requiring a real GUI environment. It's fast, safe, and perfect
                for iterating on your design.
              </p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-sm text-muted-foreground">
                <strong>Learn More:</strong>{" "}
                <Link href="/docs/web/testing" className="text-primary hover:underline">
                  Mock Testing Guide
                </Link>
              </p>
            </div>
          </div>
        </section>

        {/* Step 3: Run with Qontinui Runner */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-secondary text-secondary-foreground rounded-full flex items-center justify-center font-bold text-lg">
              3
            </div>
            <h2 className="text-2xl font-bold">
              Run with Qontinui Runner
            </h2>
          </div>

          <div className="pl-13 space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-3">
                Download Qontinui Runner
              </h3>
              <p className="text-muted-foreground mb-4">
                Download the desktop application for your operating system:
              </p>
              <Link
                href="/runner/download"
                className="inline-flex items-center gap-2 bg-secondary hover:bg-secondary/90 text-secondary-foreground px-6 py-3 rounded-lg font-semibold transition-colors"
              >
                <Download className="w-5 h-5" />
                Download Qontinui Runner
              </Link>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-3">
                Export Your Configuration
              </h3>
              <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                <li>In Qontinui Web, click "Export" in your project</li>
                <li>Save the JSON configuration file to your computer</li>
                <li>Note the location of the downloaded file</li>
              </ol>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-3">
                Load and Execute
              </h3>
              <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                <li>Open Qontinui Runner</li>
                <li>Click "Load Configuration" and select your JSON file</li>
                <li>Select the process you want to run</li>
                <li>Click "Start Execution" to run your automation</li>
              </ol>
            </div>

            <div className="bg-secondary/10 border border-secondary/30 rounded-lg p-4">
              <p className="text-sm">
                <strong>Real Automation:</strong> Qontinui Runner performs actual mouse clicks,
                keyboard input, and screen recognition on your system. Make sure you have the
                target application ready before starting execution.
              </p>
            </div>

            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-sm text-muted-foreground">
                <strong>Learn More:</strong>{" "}
                <Link href="/docs/runner/installation" className="text-primary hover:underline">
                  Installation Guide
                </Link>
                {" • "}
                <Link href="/docs/runner/execution" className="text-primary hover:underline">
                  Running Automations
                </Link>
              </p>
            </div>
          </div>
        </section>

        {/* Next Steps */}
        <section className="border-t border-border pt-12">
          <h2 className="text-2xl font-bold mb-6">
            Next Steps
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <NextStepCard
              title="Explore Examples"
              description="Learn from real-world automation projects"
              link="/docs/examples"
            />
            <NextStepCard
              title="Advanced Features"
              description="Multi-monitor support, parallel states, and more"
              link="/docs/web/overview"
            />
            <NextStepCard
              title="Python API"
              description="Use Qontinui programmatically in your code"
              link="/docs/python/quickstart"
            />
            <NextStepCard
              title="Troubleshooting"
              description="Common issues and solutions"
              link="/docs/runner/troubleshooting"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

interface NextStepCardProps {
  title: string;
  description: string;
  link: string;
}

function NextStepCard({ title, description, link }: NextStepCardProps) {
  return (
    <Link
      href={link}
      className="block bg-card border border-border rounded-lg p-6 hover:shadow-md hover:border-primary/50 transition-all"
    >
      <h3 className="font-semibold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </Link>
  );
}
