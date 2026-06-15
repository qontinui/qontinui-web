import Link from "next/link";
import { Code, CheckCircle2, AlertCircle } from "lucide-react";

export const metadata = {
  title: "Examples - Qontinui Python Documentation",
  description:
    "Practical Qontinui Python examples: finding and clicking images, tuning find options, self-healing, and AWAS web automation.",
};

export default function PythonExamplesPage() {
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
          <h1 className="text-4xl font-bold text-foreground mb-4">Examples</h1>
          <p className="text-xl text-muted-foreground">
            Practical code samples using Qontinui&apos;s public Python API
          </p>
        </div>

        {/* Intro */}
        <section className="mb-12">
          <p className="text-foreground">
            The snippets below use symbols exported directly from the{" "}
            <code className="font-mono bg-muted border border-border px-1 rounded text-sm">
              qontinui
            </code>{" "}
            package. Action methods are asynchronous coroutines, so they run
            inside an{" "}
            <code className="font-mono bg-muted border border-border px-1 rounded text-sm">
              async
            </code>{" "}
            function driven by{" "}
            <code className="font-mono bg-muted border border-border px-1 rounded text-sm">
              asyncio
            </code>
            .
          </p>
        </section>

        {/* Example 1: Find and click */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <Code className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-bold text-foreground">
              Find and Click an Image
            </h2>
          </div>
          <p className="text-foreground mb-4">
            The <code className="font-mono">Action</code> class is the central
            dispatcher for GUI operations. Its convenience helpers{" "}
            <code className="font-mono">find()</code> and{" "}
            <code className="font-mono">click()</code> accept{" "}
            <code className="font-mono">StateImage</code> targets and return an{" "}
            <code className="font-mono">ActionResult</code>:
          </p>

          <CodeBlock>
            {`import asyncio
from qontinui import Action, StateImage, Image


async def main():
    action = Action()

    # A StateImage wraps the image used to identify an element
    login_button = StateImage(
        image=Image.from_file("images/login_button.png"),
        name="login_button",
    )

    # Find returns an ActionResult with the matches that were located
    result = await action.find(login_button)
    if result.success:
        print(f"Found {len(result.matches)} match(es)")

    # Click chains Find -> Click for StateImage targets
    await action.click(login_button)


asyncio.run(main())`}
          </CodeBlock>

          <div className="bg-muted border border-border rounded-lg p-4 mt-4">
            <p className="text-sm text-foreground">
              <code className="font-mono">action.click()</code> automatically
              chains a find then a click when given a{" "}
              <code className="font-mono">StateImage</code>. For{" "}
              <code className="font-mono">Location</code> or{" "}
              <code className="font-mono">Region</code> targets it performs a
              direct click at those coordinates.
            </p>
          </div>
        </section>

        {/* Example 2: FindOptions */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <Code className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-bold text-foreground">
              Tune Matching with FindOptions
            </h2>
          </div>
          <p className="text-foreground mb-4">
            <code className="font-mono">FindOptions</code> controls how matching
            behaves — the similarity threshold, whether to return all matches,
            and an optional search region to constrain the search:
          </p>

          <CodeBlock>
            {`from qontinui import FindOptions, Region

options = FindOptions(
    similarity=0.85,        # 0.0-1.0; higher means a stricter match
    find_all=True,          # return every match, not just the first
    search_region=Region(   # limit the search to a rectangular area
        x=0, y=0, width=800, height=600, name="top_left_quadrant"
    ),
    timeout=5.0,            # seconds to keep retrying before giving up
)

print(options.similarity, options.find_all, options.search_region.width)`}
          </CodeBlock>
        </section>

        {/* Example 3: Self-healing */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <Code className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-bold text-foreground">
              Enable Self-Healing
            </h2>
          </div>
          <p className="text-foreground mb-4">
            Qontinui includes a self-healing system that recovers from element
            lookup failures using action caching, multi-scale visual search, and
            optional LLM assistance. Configure it once, then opt in per find via{" "}
            <code className="font-mono">FindOptions</code>:
          </p>

          <CodeBlock>
            {`from qontinui import configure_healing, HealingConfig, FindOptions

# Configure the self-healing system (call once at startup)
configure_healing(HealingConfig.with_ollama())

# Opt in to healing for a specific find
options = FindOptions(
    similarity=0.85,
    enable_healing=True,
    healing_context_description="Submit button",
    use_cache=True,
    store_in_cache=True,
)`}
          </CodeBlock>

          <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 mt-4">
            <ul className="space-y-2 text-sm text-foreground">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <span>
                  <strong>Action caching</strong> remembers successful element
                  locations for instant replay.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <span>
                  <strong>Visual search</strong> retries at lower thresholds and
                  multiple scales when exact matching fails.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <span>
                  <strong>LLM assistance</strong> can locate elements by the
                  description in{" "}
                  <code className="font-mono">healing_context_description</code>
                  .
                </span>
              </li>
            </ul>
          </div>
        </section>

        {/* Example 4: AWAS */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <Code className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-bold text-foreground">
              Structured Web Automation with AWAS
            </h2>
          </div>
          <p className="text-foreground mb-4">
            For websites that publish an AI Web Action Standard (AWAS) manifest,
            Qontinui can discover and execute typed actions directly over HTTP —
            no visual templates required:
          </p>

          <CodeBlock>
            {`import asyncio
from qontinui.awas.discovery import AwasDiscoveryService
from qontinui.awas.executor import AwasExecutor


async def main():
    # Discover the AWAS manifest for a site
    discovery = AwasDiscoveryService()
    manifest = await discovery.discover("https://example.com")

    # List the actions the site exposes
    for action in manifest.actions:
        print(f"{action.method} {action.endpoint}: {action.intent}")

    # Execute a typed action with parameters
    executor = AwasExecutor()
    result = await executor.execute(
        manifest=manifest,
        action_id="list_items",
        params={"limit": 10},
    )
    print(result)


asyncio.run(main())`}
          </CodeBlock>

          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mt-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-foreground">
                <strong>When to use AWAS:</strong> structured, manifest-driven
                automation is dramatically faster than vision-based matching and
                avoids maintaining image templates — but it only works for sites
                that publish an AWAS manifest. Fall back to visual automation
                for everything else.
              </p>
            </div>
          </div>
        </section>

        {/* Next Steps */}
        <section className="border-t border-border pt-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Next Steps
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <NextStepCard
              title="Installation"
              description="Set up Qontinui and optional extras"
              href="/docs/python/installation"
            />
            <NextStepCard
              title="Quick Start"
              description="Run your first automation end to end"
              href="/docs/python/quickstart"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-muted border border-border rounded-lg p-4 overflow-x-auto text-sm font-mono text-foreground">
      <code>{children}</code>
    </pre>
  );
}

interface NextStepCardProps {
  title: string;
  description: string;
  href: string;
}

function NextStepCard({ title, description, href }: NextStepCardProps) {
  return (
    <Link
      href={href}
      className="block bg-muted border border-border rounded-lg p-6 hover:shadow-md hover:border-primary/50 transition-all"
    >
      <h3 className="font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </Link>
  );
}
