import Link from "next/link";
import { Book, Rocket, Globe, Terminal, FileCode, Zap } from "lucide-react";

export const metadata = {
  title: "Qontinui Documentation - Get Started with GUI Automation",
  description:
    "Complete documentation for Qontinui GUI automation platform. Learn how to build, test, and run intelligent automation workflows.",
};

export default function DocsHomePage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-5xl font-bold text-slate-900 mb-6">
            Qontinui Documentation
          </h1>
          <p className="text-xl text-slate-600 mb-8">
            Everything you need to build intelligent GUI automation workflows
          </p>
        </div>
      </section>

      {/* Quick Start */}
      <section className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-8 mb-12">
            <div className="flex items-start gap-4">
              <Rocket className="w-8 h-8 text-blue-600 flex-shrink-0 mt-1" />
              <div>
                <h2 className="text-2xl font-bold text-slate-900 mb-3">
                  New to Qontinui?
                </h2>
                <p className="text-slate-700 mb-4">
                  Start with our getting started guide to build your first automation in minutes.
                </p>
                <Link
                  href="/docs/getting-started"
                  className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-semibold transition-colors"
                >
                  Get Started →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Main Documentation Sections */}
      <section className="container mx-auto px-4 py-8 pb-20">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">
            Documentation Sections
          </h2>
          <div className="grid md:grid-cols-2 gap-8">
            <DocSection
              icon={<Globe className="w-8 h-8 text-blue-600" />}
              title="Qontinui Web"
              description="Visual configuration builder for creating automation workflows in your browser"
              links={[
                { href: "/docs/web/overview", label: "Overview" },
                { href: "/docs/web/states", label: "Working with States" },
                { href: "/docs/web/actions", label: "Action Types" },
                { href: "/docs/web/transitions", label: "State Transitions" },
                { href: "/docs/web/testing", label: "Mock Testing" },
              ]}
            />

            <DocSection
              icon={<Terminal className="w-8 h-8 text-green-600" />}
              title="Qontinui Runner"
              description="Desktop application for executing automation workflows on your system"
              links={[
                { href: "/docs/runner/installation", label: "Installation" },
                { href: "/docs/runner/execution", label: "Running Automations" },
                { href: "/docs/runner/monitoring", label: "Monitoring & Logs" },
                { href: "/docs/runner/multi-monitor", label: "Multi-Monitor Setup" },
                { href: "/docs/runner/troubleshooting", label: "Troubleshooting" },
              ]}
            />

            <DocSection
              icon={<FileCode className="w-8 h-8 text-purple-600" />}
              title="Python API"
              description="Use Qontinui programmatically in your Python projects"
              links={[
                { href: "https://qontinui.com/api-docs", label: "API Reference", external: true },
                { href: "/docs/python/installation", label: "Installation" },
                { href: "/docs/python/quickstart", label: "Quick Start" },
                { href: "/docs/python/examples", label: "Examples" },
              ]}
            />

            <DocSection
              icon={<Zap className="w-8 h-8 text-orange-600" />}
              title="Core Concepts"
              description="Understand the model-based architecture behind Qontinui"
              links={[
                { href: "/docs/concepts/model-based", label: "Model-Based Automation" },
                { href: "/docs/concepts/states", label: "State Machines" },
                { href: "/docs/concepts/transitions", label: "Transitions & Pathfinding" },
                { href: "/docs/concepts/actions", label: "Action System" },
                { href: "/docs/concepts/image-recognition", label: "Visual Recognition" },
              ]}
            />
          </div>
        </div>
      </section>

      {/* Additional Resources */}
      <section className="border-t border-slate-200">
        <div className="container mx-auto px-4 py-16">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-slate-900 mb-8 text-center">
              Additional Resources
            </h2>
            <div className="grid md:grid-cols-3 gap-6">
              <ResourceCard
                title="GitHub Repositories"
                description="Explore the source code and contribute"
                link="https://github.com/jspinak?tab=repositories"
              />
              <ResourceCard
                title="Example Projects"
                description="Learn from real-world automation examples"
                link="/docs/examples"
              />
              <ResourceCard
                title="Community Support"
                description="Get help and share your projects"
                link="https://github.com/jspinak/qontinui/discussions"
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

interface DocSectionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  links: Array<{ href: string; label: string; external?: boolean }>;
}

function DocSection({ icon, title, description, links }: DocSectionProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6 hover:shadow-lg transition-shadow">
      <div className="flex items-start gap-4 mb-4">
        <div className="flex-shrink-0">{icon}</div>
        <div>
          <h3 className="text-xl font-bold text-slate-900 mb-2">{title}</h3>
          <p className="text-slate-600 text-sm">{description}</p>
        </div>
      </div>
      <ul className="space-y-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="text-blue-600 hover:text-blue-700 text-sm flex items-center gap-1"
              {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {link.label}
              {link.external && <span className="text-xs">↗</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface ResourceCardProps {
  title: string;
  description: string;
  link: string;
}

function ResourceCard({ title, description, link }: ResourceCardProps) {
  const isExternal = link.startsWith("http");

  return (
    <Link
      href={link}
      className="block bg-white border border-slate-200 rounded-lg p-6 hover:shadow-md transition-shadow"
      {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      <h3 className="font-semibold text-slate-900 mb-2 flex items-center gap-1">
        {title}
        {isExternal && <span className="text-xs text-slate-400">↗</span>}
      </h3>
      <p className="text-sm text-slate-600">{description}</p>
    </Link>
  );
}
