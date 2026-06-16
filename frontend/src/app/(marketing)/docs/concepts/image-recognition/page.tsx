import Link from "next/link";
import {
  ScanSearch,
  Gauge,
  Layers,
  Crop,
  Sparkles,
  AlertCircle,
} from "lucide-react";

export const metadata = {
  title: "Visual Recognition - Qontinui Documentation",
  description:
    "The theory of visual recognition in Qontinui: template matching with OpenCV, similarity thresholds, why it grounds the whole model, and where it has limits.",
};

export default function ImageRecognitionConceptPage() {
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
            Visual Recognition
          </h1>
          <p className="text-xl text-muted-foreground">
            How seeing the screen grounds the entire model
          </p>
        </div>

        {/* Why it matters */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            The Foundation of the Model
          </h2>
          <p className="text-foreground mb-4">
            Visual recognition is what connects the abstract model to a real,
            running application. It answers the one question everything else
            depends on: <strong>what is on screen right now?</strong> The answer
            tells the engine which{" "}
            <Link
              href="/docs/concepts/states"
              className="text-primary hover:underline"
            >
              states
            </Link>{" "}
            are active, where an{" "}
            <Link
              href="/docs/concepts/actions"
              className="text-primary hover:underline"
            >
              action&apos;s
            </Link>{" "}
            target sits, and whether a{" "}
            <Link
              href="/docs/concepts/transitions"
              className="text-primary hover:underline"
            >
              transition
            </Link>{" "}
            actually reached its destination.
          </p>

          <div className="bg-primary/10 border border-primary/30 rounded-lg p-6">
            <h3 className="font-semibold text-foreground mb-3">
              Key Concept: Match the Picture, Not the Code
            </h3>
            <p className="text-sm text-foreground">
              Instead of reading element IDs, CSS selectors, or DOM trees,
              Qontinui compares <strong>screenshot images</strong> against the
              live screen. This makes the model independent of the
              application&apos;s internals — it works the same on a web app, a
              desktop app, or a game.
            </p>
          </div>
        </section>

        {/* Template matching */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            How Template Matching Works
          </h2>
          <p className="text-foreground mb-6">
            Qontinui uses <strong>template matching</strong> built on{" "}
            <Link
              href="https://opencv.org/"
              className="text-primary hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenCV
            </Link>
            . A small reference image (the pattern) is slid across the captured
            screen, and at each position the pixels are compared to produce a
            similarity score.
          </p>

          <div className="bg-muted border border-border rounded-lg p-6">
            <ol className="space-y-3 text-sm text-foreground">
              <li className="flex items-start gap-2">
                <span className="font-bold text-primary">1.</span>
                <span>
                  The engine captures the current screen (or a region of it)
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-primary">2.</span>
                <span>
                  Your pattern image is compared against the screen using OpenCV
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-primary">3.</span>
                <span>
                  A similarity score from 0.0 to 1.0 is produced for the best
                  position
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-primary">4.</span>
                <span>
                  If the score clears the threshold, the element is considered
                  found, and its location is returned
                </span>
              </li>
            </ol>
          </div>
        </section>

        {/* Key ideas */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Concepts That Shape a Match
          </h2>

          <div className="space-y-6">
            <ConceptCard
              icon={<Gauge className="w-6 h-6 text-purple-600" />}
              title="Similarity Threshold"
              description="The minimum score required to count as a match. A lower threshold tolerates more variation (themes, anti-aliasing) but risks false matches; a higher threshold demands near-exact pixels. It is the central trade-off between flexibility and precision."
            />
            <ConceptCard
              icon={<ScanSearch className="w-6 h-6 text-primary" />}
              title="Search Regions"
              description="Restricting matching to a rectangular area of the screen makes it faster and avoids confusing a target with a look-alike elsewhere. Narrowing where to look is one of the most effective ways to make recognition both quick and reliable."
            />
            <ConceptCard
              icon={<Layers className="w-6 h-6 text-green-600" />}
              title="Multiple Patterns"
              description="A single element can be represented by several patterns — one per theme, language, or state. The engine matches if any pattern hits, which is how a model stays robust across visual variations."
            />
            <ConceptCard
              icon={<Crop className="w-6 h-6 text-orange-600" />}
              title="Tight, Lossless Captures"
              description="Cropping to just the distinctive element and storing it without lossy compression keeps matches fast and accurate. Large or compressed images slow the search and introduce artifacts that degrade the score."
            />
          </div>
        </section>

        {/* Limits and beyond */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Limits &amp; What Lies Beyond
          </h2>
          <p className="text-foreground mb-6">
            Pure pixel matching has natural limits: heavily dynamic content,
            large resolution shifts, or elements whose text changes can all
            lower the score. Qontinui addresses these in two ways.
          </p>

          <div className="bg-card border border-border rounded-lg p-6 mb-6">
            <div className="flex items-start gap-4">
              <Sparkles className="w-6 h-6 text-purple-600 flex-shrink-0 mt-1" />
              <div>
                <h3 className="text-lg font-bold text-foreground mb-2">
                  Self-Healing Recovery
                </h3>
                <p className="text-sm text-muted-foreground">
                  When exact matching fails, the engine can retry at lower
                  thresholds and multiple scales, fall back to cached locations,
                  or — optionally — ask a vision model to locate an element from
                  a description. Recognition degrades gracefully rather than
                  failing hard.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-foreground">
                <strong>Note:</strong> This page covers the theory. For
                practical guidance on capturing images, tuning thresholds, and
                troubleshooting matches in the builder, see the{" "}
                <Link
                  href="/docs/web/image-recognition"
                  className="text-primary hover:underline"
                >
                  Image Recognition guide
                </Link>
                .
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
              title="State Machines"
              description="How recognized images identify active states"
              href="/docs/concepts/states"
            />
            <NextStepCard
              title="Image Recognition (How-To)"
              description="Capture and tune images in Qontinui Web"
              href="/docs/web/image-recognition"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

interface ConceptCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function ConceptCard({ icon, title, description }: ConceptCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 mt-1">{icon}</div>
        <div>
          <h3 className="text-lg font-bold text-foreground mb-2">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
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
