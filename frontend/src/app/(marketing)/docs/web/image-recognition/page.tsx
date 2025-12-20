import Link from "next/link";
import {
  Image,
  Layers,
  Target,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

export const metadata = {
  title: "Image Recognition - Qontinui Web Documentation",
  description:
    "Learn how Qontinui uses visual recognition and template matching for reliable GUI automation.",
};

export default function ImageRecognitionDocPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {/* Header */}
        <div className="mb-12">
          <Link
            href="/docs/web"
            className="text-primary hover:text-primary/80 text-sm mb-4 inline-block"
          >
            ← Back to Qontinui Web Docs
          </Link>
          <h1 className="text-4xl font-bold text-foreground mb-4">
            Image Recognition
          </h1>
          <p className="text-xl text-muted-foreground">
            Understanding how Qontinui identifies UI elements visually
          </p>
        </div>

        {/* What is Image Recognition */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            How Image Recognition Works
          </h2>
          <p className="text-foreground mb-4">
            Qontinui uses <strong>template matching</strong> to find UI elements
            on screen. Instead of relying on element IDs, CSS selectors, or
            hardcoded coordinates, Qontinui visually compares screenshot images
            against the current screen to locate buttons, dialogs, and other
            elements.
          </p>

          <div className="bg-primary/10 border border-primary/30 rounded-lg p-6 mb-6">
            <h3 className="font-semibold text-foreground mb-3">
              Why Visual Recognition?
            </h3>
            <ul className="space-y-2 text-sm text-foreground">
              <li className="flex items-start gap-2">
                <span className="font-bold">•</span>
                <span>
                  <strong>Resolution independent:</strong> Works across
                  different screen sizes and DPI settings
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold">•</span>
                <span>
                  <strong>UI framework agnostic:</strong> Works with any
                  application (web, desktop, games)
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold">•</span>
                <span>
                  <strong>Resilient to minor changes:</strong> Similarity
                  thresholds tolerate small visual variations
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold">•</span>
                <span>
                  <strong>Simple to configure:</strong> Just capture
                  screenshots, no need to inspect DOM or learn APIs
                </span>
              </li>
            </ul>
          </div>

          <div className="bg-muted border border-border rounded-lg p-6">
            <h3 className="font-semibold text-foreground mb-3">
              The Template Matching Process
            </h3>
            <ol className="space-y-3 text-sm text-foreground">
              <li className="flex items-start gap-2">
                <span className="font-bold text-primary">1.</span>
                <span>Qontinui captures the current screen (or a region)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-primary">2.</span>
                <span>
                  Your pattern image is compared pixel-by-pixel using OpenCV
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-primary">3.</span>
                <span>
                  A similarity score (0.0-1.0) is calculated based on how
                  closely pixels match
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-primary">4.</span>
                <span>
                  If the score exceeds your threshold, the element is considered
                  "found"
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold text-primary">5.</span>
                <span>
                  The location (x, y coordinates) is returned for clicking or
                  verification
                </span>
              </li>
            </ol>
          </div>
        </section>

        {/* Key Concepts */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Key Concepts
          </h2>

          <div className="space-y-6">
            <ConceptCard
              icon={<Target className="w-6 h-6 text-purple-600" />}
              title="Similarity Threshold"
              description="Controls how closely the screen must match your pattern image"
            >
              <div className="space-y-3 mt-4">
                <ThresholdRange
                  range="0.70 - 0.80"
                  label="Fuzzy Matching"
                  description="More tolerant of variations. Use for elements that change slightly (e.g., different themes, slight color shifts)."
                  color="yellow"
                />
                <ThresholdRange
                  range="0.85 - 0.90"
                  label="Standard Matching (Recommended)"
                  description="Balanced accuracy. Works well for most UI elements with minor anti-aliasing or compression differences."
                  color="green"
                />
                <ThresholdRange
                  range="0.95+"
                  label="Exact Matching"
                  description="Very strict. Only use when elements must match perfectly (e.g., pixel-perfect logos, fixed graphics)."
                  color="red"
                />
              </div>
            </ConceptCard>

            <ConceptCard
              icon={<Layers className="w-6 h-6 text-primary" />}
              title="Patterns"
              description="Individual image templates within a StateImage"
            >
              <p className="text-sm text-foreground mt-3 mb-3">
                Each StateImage can contain multiple patterns representing
                different variations of the same element. This enables matching
                across:
              </p>
              <ul className="text-sm text-foreground space-y-1">
                <li className="flex items-start gap-2">
                  <span className="text-primary">•</span>
                  <span>Light and dark themes</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary">•</span>
                  <span>Different languages (button text changes)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary">•</span>
                  <span>Hover/active/disabled states</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary">•</span>
                  <span>Different resolutions or zoom levels</span>
                </li>
              </ul>
            </ConceptCard>

            <ConceptCard
              icon={<Image className="w-6 h-6 text-green-600" />}
              title="Masks"
              description="Optional masks that define which pixels to compare"
            >
              <p className="text-sm text-foreground mt-3 mb-3">
                Masks allow you to ignore certain parts of an image during
                matching. White pixels (255) are compared, black pixels (0) are
                ignored. Use masks to:
              </p>
              <ul className="text-sm text-foreground space-y-1">
                <li className="flex items-start gap-2">
                  <span className="text-green-600">•</span>
                  <span>Ignore dynamic text within buttons</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-600">•</span>
                  <span>
                    Match partial elements (e.g., icon only, not surrounding
                    area)
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-600">•</span>
                  <span>Handle elements with variable content</span>
                </li>
              </ul>
            </ConceptCard>

            <ConceptCard
              icon={<Target className="w-6 h-6 text-orange-600" />}
              title="Search Regions"
              description="Rectangular areas that limit where to search for images"
            >
              <p className="text-sm text-foreground mt-3 mb-3">
                Search regions improve performance and accuracy by restricting
                template matching to specific screen areas. Benefits include:
              </p>
              <ul className="text-sm text-foreground space-y-1">
                <li className="flex items-start gap-2">
                  <span className="text-orange-600">•</span>
                  <span>Faster execution (less area to search)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-orange-600">•</span>
                  <span>
                    Avoid false matches from similar elements elsewhere
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-orange-600">•</span>
                  <span>Multi-monitor support (search specific monitor)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-orange-600">•</span>
                  <span>
                    Focus on relevant UI sections (sidebars, toolbars, content
                    areas)
                  </span>
                </li>
              </ul>
            </ConceptCard>
          </div>
        </section>

        {/* Best Practices for Image Capture */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Best Practices for Capturing Images
          </h2>

          <div className="space-y-4">
            <BestPractice
              icon={<CheckCircle2 className="w-5 h-5 text-green-600" />}
              title="Crop tightly to the essential element"
              description="Capture just the button, icon, or label - not the entire screen or large surrounding areas. Smaller images match faster and more accurately."
              type="success"
            />

            <BestPractice
              icon={<CheckCircle2 className="w-5 h-5 text-green-600" />}
              title="Use PNG format for best quality"
              description="PNG preserves exact pixel values without compression artifacts. JPEG compression can cause template matching failures."
              type="success"
            />

            <BestPractice
              icon={<CheckCircle2 className="w-5 h-5 text-green-600" />}
              title="Capture at the same resolution you'll run automation"
              description="If possible, capture screenshots at the same screen resolution and DPI settings where automation will execute. Enable multi-scale search if resolution varies."
              type="success"
            />

            <BestPractice
              icon={<CheckCircle2 className="w-5 h-5 text-green-600" />}
              title="Include unique visual features"
              description="Capture elements with distinctive colors, shapes, or text. Avoid generic elements that appear multiple times on screen."
              type="success"
            />

            <BestPractice
              icon={<CheckCircle2 className="w-5 h-5 text-green-600" />}
              title="Use multiple patterns for dynamic elements"
              description="If an element changes appearance (theme, language, state), capture multiple patterns and add them all to the StateImage."
              type="success"
            />

            <BestPractice
              icon={<AlertTriangle className="w-5 h-5 text-yellow-600" />}
              title="Avoid blurry or low-contrast images"
              description="Ensure screenshots are crisp and clear. Motion blur, poor lighting, or low contrast reduces matching accuracy."
              type="warning"
            />

            <BestPractice
              icon={<AlertTriangle className="w-5 h-5 text-yellow-600" />}
              title="Don't capture animated elements mid-animation"
              description="Wait for animations to complete before capturing. Animated elements should be captured in their stable, final state."
              type="warning"
            />

            <BestPractice
              icon={<AlertTriangle className="w-5 h-5 text-yellow-600" />}
              title="Be careful with text-based elements"
              description="Text can vary by font rendering, anti-aliasing, and locale. Consider using masks to ignore text or capture icon-only portions."
              type="warning"
            />
          </div>
        </section>

        {/* Troubleshooting Recognition Issues */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Troubleshooting Recognition Issues
          </h2>

          <div className="space-y-6">
            <TroubleshootingCard
              problem="Image not found (false negative)"
              solutions={[
                "Lower the similarity threshold (try 0.8 instead of 0.9)",
                "Check if the UI element has changed appearance slightly",
                "Verify the pattern image matches what&apos;s currently on screen",
                "Add a search region if searching the entire screen",
                "Enable multi-scale search if resolution differs",
                "Capture a new screenshot if the element has been updated",
              ]}
            />

            <TroubleshootingCard
              problem="Wrong element matched (false positive)"
              solutions={[
                "Raise the similarity threshold (try 0.95 instead of 0.85)",
                "Capture a more specific image with unique visual features",
                "Use search regions to limit matching to the correct screen area",
                "Make the pattern image larger to include more context",
                "Avoid matching very generic elements (plain buttons, white boxes)",
              ]}
            />

            <TroubleshootingCard
              problem="Matching is too slow"
              solutions={[
                "Use search regions to limit the search area",
                "Make pattern images smaller (crop to essential features)",
                "Disable multi-scale search if resolution doesn&apos;t vary",
                "Switch to grayscale color space (faster but less accurate)",
                "Mark static elements as fixed=true for optimization",
              ]}
            />

            <TroubleshootingCard
              problem="Works on one machine but not another"
              solutions={[
                "Verify screen resolution and DPI settings match",
                "Enable multi-scale search for resolution independence",
                "Check if theme or appearance settings differ (light/dark mode)",
                "Add multiple patterns for each visual variation",
                "Lower similarity threshold to tolerate minor rendering differences",
              ]}
            />
          </div>
        </section>

        {/* Advanced Settings */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Advanced Recognition Settings
          </h2>

          <div className="space-y-4">
            <SettingCard
              name="multi_scale_search"
              type="Boolean"
              defaultValue="true"
              description="Search for images at multiple scales/resolutions. Enables resolution-independent matching but significantly slower."
            />

            <SettingCard
              name="color_space"
              type="String"
              defaultValue="rgb"
              description="Color space for comparison: 'rgb' (most accurate), 'grayscale' (fastest), 'hsv' (lighting independent)."
            />

            <SettingCard
              name="edge_detection"
              type="Boolean"
              defaultValue="false"
              description="Use edge detection preprocessing. Helps when lighting conditions vary but may reduce accuracy for color-based matching."
            />

            <SettingCard
              name="default_threshold"
              type="Float (0.0-1.0)"
              defaultValue="0.85"
              description="Global default threshold for all images. Individual StateImages can override this value."
            />
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mt-6">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-foreground">
                <strong>Note:</strong> Most users should keep default settings.
                Only adjust these if you&apos;re experiencing specific
                recognition issues or need to optimize performance.
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
              title="Working with States"
              description="Learn how to use images for state identification"
              href="/docs/web/states"
            />
            <NextStepCard
              title="Action Types"
              description="Use FIND, EXISTS, and VANISH actions for recognition"
              href="/docs/web/actions"
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
  children: React.ReactNode;
}

function ConceptCard({ icon, title, description, children }: ConceptCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-start gap-4 mb-3">
        <div className="flex-shrink-0 mt-1">{icon}</div>
        <div>
          <h3 className="text-lg font-bold text-foreground mb-1">{title}</h3>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

interface ThresholdRangeProps {
  range: string;
  label: string;
  description: string;
  color: "green" | "yellow" | "red";
}

function ThresholdRange({
  range,
  label,
  description,
  color,
}: ThresholdRangeProps) {
  const colorClasses = {
    green: "bg-green-500/10 border-green-500/30 text-foreground",
    yellow: "bg-yellow-500/10 border-yellow-500/30 text-foreground",
    red: "bg-red-500/10 border-red-500/30 text-foreground",
  };

  return (
    <div className={`border rounded-lg p-3 ${colorClasses[color]}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-mono font-bold text-sm">{range}</span>
        <span className="text-xs font-semibold">{label}</span>
      </div>
      <p className="text-xs">{description}</p>
    </div>
  );
}

interface BestPracticeProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  type: "success" | "warning";
}

function BestPractice({ icon, title, description, type }: BestPracticeProps) {
  const bgColor = type === "success" ? "bg-green-500/10" : "bg-yellow-500/10";
  const borderColor =
    type === "success" ? "border-green-500/30" : "border-yellow-500/30";

  return (
    <div className={`${bgColor} ${borderColor} border rounded-lg p-4`}>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">{icon}</div>
        <div>
          <h4 className="font-semibold mb-1 text-foreground">{title}</h4>
          <p className="text-sm text-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}

interface TroubleshootingCardProps {
  problem: string;
  solutions: string[];
}

function TroubleshootingCard({ problem, solutions }: TroubleshootingCardProps) {
  return (
    <div className="bg-muted border border-border rounded-lg p-6">
      <h3 className="font-semibold text-foreground mb-3">Problem: {problem}</h3>
      <p className="text-xs font-semibold text-muted-foreground mb-2">
        Possible Solutions:
      </p>
      <ul className="space-y-2">
        {solutions.map((solution, idx) => (
          <li
            key={idx}
            className="flex items-start gap-2 text-sm text-foreground"
          >
            <span className="text-primary font-bold">•</span>
            <span>{solution}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface SettingCardProps {
  name: string;
  type: string;
  defaultValue: string;
  description: string;
}

function SettingCard({
  name,
  type,
  defaultValue,
  description,
}: SettingCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-start justify-between mb-2">
        <h4 className="font-mono font-semibold text-foreground">{name}</h4>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono bg-muted px-2 py-1 rounded text-muted-foreground">
            {type}
          </span>
        </div>
      </div>
      <p className="text-sm text-foreground mb-2">{description}</p>
      <p className="text-xs text-muted-foreground">
        Default:{" "}
        <span className="font-mono bg-muted px-1 rounded">{defaultValue}</span>
      </p>
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
