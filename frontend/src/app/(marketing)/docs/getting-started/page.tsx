import Link from "next/link";
import { Download, Globe, Play, CheckCircle } from "lucide-react";

export const metadata = {
  title: "Getting Started with Qontinui - Quick Start Guide",
  description:
    "Learn how to create your first GUI automation workflow with Qontinui in just a few minutes.",
};

export default function GettingStartedPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {/* Header */}
        <div className="mb-12">
          <Link
            href="/docs"
            className="text-blue-600 hover:text-blue-700 text-sm mb-4 inline-block"
          >
            ← Back to Documentation
          </Link>
          <h1 className="text-4xl font-bold text-slate-900 mb-4">
            Getting Started
          </h1>
          <p className="text-xl text-slate-600">
            Create your first GUI automation workflow in 3 simple steps
          </p>
        </div>

        {/* Overview */}
        <section className="mb-12">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-slate-900 mb-3">
              What You'll Learn
            </h2>
            <ul className="space-y-2">
              <li className="flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <span className="text-slate-700">
                  How to build automation workflows in Qontinui Web
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <span className="text-slate-700">
                  How to test your automation with mock execution
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <span className="text-slate-700">
                  How to run your automation with Qontinui Runner
                </span>
              </li>
            </ul>
          </div>
        </section>

        {/* Step 1: Build in Web */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
              1
            </div>
            <h2 className="text-2xl font-bold text-slate-900">
              Build Your Automation in Qontinui Web
            </h2>
          </div>

          <div className="pl-13 space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 mb-3">
                Create a Free Account
              </h3>
              <p className="text-slate-700 mb-4">
                Visit{" "}
                <Link
                  href="https://qontinui.com"
                  className="text-blue-600 hover:text-blue-700 underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  qontinui.com
                </Link>{" "}
                and sign up for a free account. No credit card required.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-slate-900 mb-3">
                Create Your First Project
              </h3>
              <ol className="list-decimal list-inside space-y-2 text-slate-700">
                <li>Click "New Project" in your dashboard</li>
                <li>Give your project a name (e.g., "My First Automation")</li>
                <li>Click "Create" to open the automation builder</li>
              </ol>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-slate-900 mb-3">
                Define Your States
              </h3>
              <p className="text-slate-700 mb-3">
                States represent the different screens or conditions in your application. For example:
              </p>
              <ul className="list-disc list-inside space-y-1 text-slate-700 ml-4">
                <li>Login Screen</li>
                <li>Dashboard</li>
                <li>Settings Page</li>
              </ul>
              <p className="text-slate-600 text-sm mt-3">
                <strong>Tip:</strong> Add identifying images to each state so Qontinui can recognize when it's active.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-slate-900 mb-3">
                Add Actions and Transitions
              </h3>
              <p className="text-slate-700 mb-3">
                Connect your states with transitions that define:
              </p>
              <ul className="list-disc list-inside space-y-1 text-slate-700 ml-4">
                <li>What actions to perform (click, type, wait, etc.)</li>
                <li>Which state to navigate to next</li>
                <li>When the transition should occur</li>
              </ul>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <p className="text-sm text-slate-700">
                <strong>Learn More:</strong>{" "}
                <Link href="/docs/web/states" className="text-blue-600 hover:text-blue-700">
                  Working with States
                </Link>
                {" • "}
                <Link href="/docs/web/actions" className="text-blue-600 hover:text-blue-700">
                  Action Types
                </Link>
                {" • "}
                <Link href="/docs/web/transitions" className="text-blue-600 hover:text-blue-700">
                  State Transitions
                </Link>
              </p>
            </div>
          </div>
        </section>

        {/* Step 2: Test with Mock Execution */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-green-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
              2
            </div>
            <h2 className="text-2xl font-bold text-slate-900">
              Test with Mock Execution
            </h2>
          </div>

          <div className="pl-13 space-y-4">
            <p className="text-slate-700">
              Before running on real systems, test your automation logic directly in the browser:
            </p>
            <ol className="list-decimal list-inside space-y-2 text-slate-700">
              <li>Click the "Test" button in the automation builder</li>
              <li>Select your starting process or state</li>
              <li>Watch as Qontinui simulates the execution flow</li>
              <li>Review the execution log to verify your logic</li>
            </ol>
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mt-4">
              <p className="text-sm text-green-900">
                <strong>Why Mock Testing?</strong> Mock execution lets you validate your state machine
                and automation logic without requiring a real GUI environment. It's fast, safe, and perfect
                for iterating on your design.
              </p>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <p className="text-sm text-slate-700">
                <strong>Learn More:</strong>{" "}
                <Link href="/docs/web/testing" className="text-blue-600 hover:text-blue-700">
                  Mock Testing Guide
                </Link>
              </p>
            </div>
          </div>
        </section>

        {/* Step 3: Run with Qontinui Runner */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-purple-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
              3
            </div>
            <h2 className="text-2xl font-bold text-slate-900">
              Run with Qontinui Runner
            </h2>
          </div>

          <div className="pl-13 space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 mb-3">
                Download Qontinui Runner
              </h3>
              <p className="text-slate-700 mb-4">
                Download the desktop application for your operating system:
              </p>
              <Link
                href="/runner/download"
                className="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
              >
                <Download className="w-5 h-5" />
                Download Qontinui Runner
              </Link>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-slate-900 mb-3">
                Export Your Configuration
              </h3>
              <ol className="list-decimal list-inside space-y-2 text-slate-700">
                <li>In Qontinui Web, click "Export" in your project</li>
                <li>Save the JSON configuration file to your computer</li>
                <li>Note the location of the downloaded file</li>
              </ol>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-slate-900 mb-3">
                Load and Execute
              </h3>
              <ol className="list-decimal list-inside space-y-2 text-slate-700">
                <li>Open Qontinui Runner</li>
                <li>Click "Load Configuration" and select your JSON file</li>
                <li>Select the process you want to run</li>
                <li>Click "Start Execution" to run your automation</li>
              </ol>
            </div>

            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <p className="text-sm text-purple-900">
                <strong>Real Automation:</strong> Qontinui Runner performs actual mouse clicks,
                keyboard input, and screen recognition on your system. Make sure you have the
                target application ready before starting execution.
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <p className="text-sm text-slate-700">
                <strong>Learn More:</strong>{" "}
                <Link href="/docs/runner/installation" className="text-blue-600 hover:text-blue-700">
                  Installation Guide
                </Link>
                {" • "}
                <Link href="/docs/runner/execution" className="text-blue-600 hover:text-blue-700">
                  Running Automations
                </Link>
              </p>
            </div>
          </div>
        </section>

        {/* Next Steps */}
        <section className="border-t border-slate-200 pt-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
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
      className="block bg-slate-50 border border-slate-200 rounded-lg p-6 hover:shadow-md hover:border-blue-300 transition-all"
    >
      <h3 className="font-semibold text-slate-900 mb-2">{title}</h3>
      <p className="text-sm text-slate-600">{description}</p>
    </Link>
  );
}
