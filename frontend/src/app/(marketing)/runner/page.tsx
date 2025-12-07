import Link from "next/link";
import { Download, Play, Settings, Monitor } from "lucide-react";

export const metadata = {
  title: "Qontinui Runner - Desktop Automation Executor",
  description:
    "Desktop application for running Qontinui GUI automation projects. Execute, monitor, and manage your automation workflows with an intuitive interface.",
};

export default function RunnerPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-5xl font-bold text-slate-900 mb-6">
            Qontinui Runner
          </h1>
          <p className="text-xl text-slate-600 mb-8">
            Desktop application for executing GUI automation workflows
          </p>
          <div className="flex gap-4 justify-center">
            <Link
              href="/runner/download"
              className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-semibold flex items-center gap-2 transition-colors"
            >
              <Download className="w-5 h-5" />
              Download Now
            </Link>
            <Link
              href="/docs/runner"
              className="bg-slate-100 hover:bg-slate-200 text-slate-900 px-8 py-3 rounded-lg font-semibold transition-colors"
            >
              Documentation
            </Link>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">
            Everything you need to run automation
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            <FeatureCard
              icon={<Play className="w-8 h-8 text-blue-600" />}
              title="Easy Execution"
              description="Load automation configs and start execution with a single click"
            />
            <FeatureCard
              icon={<Monitor className="w-8 h-8 text-green-600" />}
              title="Multi-Monitor Support"
              description="Run automation across multiple monitors with precise targeting"
            />
            <FeatureCard
              icon={<Settings className="w-8 h-8 text-purple-600" />}
              title="Real-time Monitoring"
              description="Watch automation progress with live logs and state transitions"
            />
            <FeatureCard
              icon={<Download className="w-8 h-8 text-orange-600" />}
              title="Cross-Platform"
              description="Available for Windows, macOS, and Linux"
            />
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl font-bold text-center mb-12">
              How it works
            </h2>
            <div className="space-y-8">
              <Step
                number={1}
                title="Create automation in Qontinui Web"
                description="Design your automation workflows using the visual editor at qontinui.com"
              />
              <Step
                number={2}
                title="Export configuration"
                description="Export your automation as a JSON configuration file"
              />
              <Step
                number={3}
                title="Load in Runner"
                description="Open the configuration file in Qontinui Runner desktop app"
              />
              <Step
                number={4}
                title="Execute and monitor"
                description="Run your automation and watch it execute in real-time"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Code Signing Info */}
      <section className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto bg-blue-50 border border-blue-200 rounded-lg p-8">
          <h2 className="text-2xl font-bold mb-4 text-slate-900">
            Security & Code Signing
          </h2>
          <p className="text-slate-700 mb-4">
            All Windows installers for Qontinui Runner are digitally signed by
            the{" "}
            <a
              href="https://signpath.io/"
              className="text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              SignPath Foundation
            </a>
            , a non-profit organization providing free code signing for open
            source projects.
          </p>
          <p className="text-slate-700 mb-4">
            macOS releases are signed and notarized by Apple using our Developer
            ID certificate to ensure authenticity and security.
          </p>
          <details className="text-sm text-slate-600">
            <summary className="cursor-pointer font-semibold hover:text-slate-900">
              View certificate details
            </summary>
            <div className="mt-4 bg-white p-4 rounded border border-blue-200">
              <p className="font-mono text-xs">
                Subject: CN=SignPath Foundation, O=SignPath Foundation, L=Lewes,
                S=Delaware, C=US
              </p>
              <p className="font-mono text-xs mt-2">Issuer: DigiCert</p>
              <p className="font-mono text-xs mt-2">Algorithm: SHA256</p>
            </div>
          </details>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-gradient-to-r from-blue-600 to-blue-700 py-16">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold text-white mb-6">
            Ready to automate?
          </h2>
          <p className="text-xl text-blue-100 mb-8">
            Download Qontinui Runner and start executing your automation
            workflows
          </p>
          <Link
            href="/runner/download"
            className="bg-white hover:bg-slate-100 text-blue-600 px-8 py-3 rounded-lg font-semibold inline-flex items-center gap-2 transition-colors"
          >
            <Download className="w-5 h-5" />
            Download for Free
          </Link>
        </div>
      </section>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="bg-white p-6 rounded-lg border border-slate-200 hover:border-blue-300 transition-colors">
      <div className="mb-4">{icon}</div>
      <h3 className="text-lg font-semibold mb-2 text-slate-900">{title}</h3>
      <p className="text-slate-600 text-sm">{description}</p>
    </div>
  );
}

function Step({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-6 items-start">
      <div className="flex-shrink-0 w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
        {number}
      </div>
      <div>
        <h3 className="text-xl font-semibold mb-2 text-slate-900">{title}</h3>
        <p className="text-slate-600">{description}</p>
      </div>
    </div>
  );
}
