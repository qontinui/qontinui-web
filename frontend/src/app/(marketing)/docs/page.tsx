import Link from "next/link";
import { Rocket, Globe, Terminal, FileCode, Zap } from "lucide-react";

export const metadata = {
  title: "Qontinui Documentation - Get Started",
  description:
    "Complete documentation for the Qontinui AI development platform. Learn how to orchestrate AI coding sessions with verification loops, error monitoring, and workflow automation.",
};

export default function DocsHomePage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-5xl font-bold mb-6">Qontinui Documentation</h1>
          <p className="text-xl text-muted-foreground mb-8">
            Everything you need to orchestrate AI development with feedback
            loops
          </p>
        </div>
      </section>

      {/* Quick Start */}
      <section className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-primary/10 border border-primary/30 rounded-lg p-8 mb-12">
            <div className="flex items-start gap-4">
              <Rocket className="w-8 h-8 text-primary flex-shrink-0 mt-1" />
              <div>
                <h2 className="text-2xl font-bold mb-3">New to Qontinui?</h2>
                <p className="text-muted-foreground mb-4">
                  Start with our getting started guide to build your first
                  automation in minutes.
                </p>
                <Link
                  href="/docs/getting-started"
                  className="inline-block bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-2 rounded-lg font-semibold transition-colors"
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
              icon={<Globe className="w-8 h-8 text-primary" />}
              title="Qontinui Web"
              description="Configuration builder for creating automation workflows in your browser"
              links={[
                { href: "/docs/web", label: "Overview" },
                { href: "/docs/web/states", label: "Working with States" },
                { href: "/docs/web/actions", label: "Action Types" },
                { href: "/docs/web/transitions", label: "State Transitions" },
                { href: "/docs/web/testing", label: "Mock Testing" },
              ]}
            />

            <DocSection
              icon={<Terminal className="w-8 h-8 text-accent" />}
              title="Qontinui Runner"
              description="Desktop application for orchestrating AI coding sessions with feedback loops"
              links={[
                { href: "/docs/runner/installation", label: "Installation" },
                {
                  href: "/docs/runner/execution",
                  label: "Running Automations",
                },
                { href: "/docs/runner/monitoring", label: "Monitoring & Logs" },
                {
                  href: "/docs/runner/multi-monitor",
                  label: "Multi-Monitor Setup",
                },
                {
                  href: "/docs/runner/ai-integration",
                  label: "AI Integration",
                },
                {
                  href: "/docs/runner/workflow-descriptions",
                  label: "Workflow Descriptions for MCP",
                },
                {
                  href: "/docs/runner/troubleshooting",
                  label: "Troubleshooting",
                },
              ]}
            />

            <DocSection
              icon={<FileCode className="w-8 h-8 text-secondary" />}
              title="Python API"
              description="Use Qontinui programmatically in your Python projects"
              links={[
                {
                  href: "https://github.com/qontinui/qontinui",
                  label: "API Reference (source)",
                  external: true,
                },
                { href: "/docs/python/installation", label: "Installation" },
                { href: "/docs/python/quickstart", label: "Quick Start" },
                { href: "/docs/python/examples", label: "Examples" },
              ]}
            />

            <DocSection
              icon={<Zap className="w-8 h-8 text-primary" />}
              title="Core Concepts"
              description="Understand the architecture behind Qontinui"
              links={[
                {
                  href: "/docs/concepts/model-based",
                  label: "Model-Based Automation",
                },
                { href: "/docs/concepts/states", label: "State Machines" },
                {
                  href: "/docs/concepts/transitions",
                  label: "Transitions & Pathfinding",
                },
                { href: "/docs/concepts/actions", label: "Action System" },
                {
                  href: "/docs/concepts/image-recognition",
                  label: "Visual Recognition",
                },
              ]}
            />
          </div>
        </div>
      </section>

      {/* Additional Resources */}
      <section className="border-t border-border">
        <div className="container mx-auto px-4 py-16">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold mb-8 text-center">
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
                link="https://github.com/qontinui/qontinui/issues"
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
    <div className="bg-card border border-border rounded-lg p-6 hover:shadow-lg hover:border-primary/50 transition-all">
      <div className="flex items-start gap-4 mb-4">
        <div className="flex-shrink-0">{icon}</div>
        <div>
          <h3 className="text-xl font-bold mb-2">{title}</h3>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
      </div>
      <ul className="space-y-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="text-primary hover:underline text-sm flex items-center gap-1"
              {...(link.external
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
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
      className="block bg-card border border-border rounded-lg p-6 hover:shadow-md hover:border-primary/50 transition-all"
      {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      <h3 className="font-semibold mb-2 flex items-center gap-1">
        {title}
        {isExternal && <span className="text-xs text-muted-foreground">↗</span>}
      </h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </Link>
  );
}
