/**
 * Quality Guidelines section content.
 */

import { GuidelineSection } from "./GuidelineSection";

export function QualityGuidelinesSection() {
  return (
    <GuidelineSection title="4. Quality Guidelines">
      <div className="space-y-4 text-sm">
        <div>
          <h4 className="font-medium text-text-primary mb-2">
            Minimum Bounding Box Size
          </h4>
          <p className="text-text-secondary">
            Bounding boxes should be at least 10x10 pixels. Very small
            annotations may be difficult to detect and train models on. If an
            element is smaller than this threshold, consider whether it should
            be annotated at all.
          </p>
        </div>

        <div>
          <h4 className="font-medium text-text-primary mb-2">
            Handling Overlapping Elements
          </h4>
          <ul className="list-disc list-inside space-y-1 text-text-secondary">
            <li>
              <strong>Nested elements:</strong> Annotate both the container and
              its children separately (e.g., a card container and buttons inside
              it).
            </li>
            <li>
              <strong>Partially overlapping:</strong> Draw boxes that accurately
              represent each element&apos;s boundaries, even if they overlap.
            </li>
            <li>
              <strong>Stacked elements:</strong> Annotate visible elements only.
              Do not annotate elements hidden behind others.
            </li>
          </ul>
        </div>

        <div>
          <h4 className="font-medium text-text-primary mb-2">
            When to Use Each Element Type
          </h4>
          <ul className="list-disc list-inside space-y-1 text-text-secondary">
            <li>
              Use <strong>Button</strong> for elements that perform actions when
              clicked (submit, save, cancel).
            </li>
            <li>
              Use <strong>Link</strong> for elements that navigate to other
              pages or locations.
            </li>
            <li>
              Use <strong>Icon</strong> only for standalone icons or icon
              buttons, not icons within buttons.
            </li>
            <li>
              Use <strong>Container</strong> for grouping elements; do not use
              for single elements.
            </li>
            <li>
              Use <strong>Other</strong> sparingly - try to find a more specific
              type first.
            </li>
          </ul>
        </div>

        <div>
          <h4 className="font-medium text-text-primary mb-2">
            Common Mistakes to Avoid
          </h4>
          <ul className="list-disc list-inside space-y-1 text-text-secondary">
            <li>
              Do not include browser chrome or window decorations in
              annotations.
            </li>
            <li>Do not annotate disabled or invisible elements.</li>
            <li>Do not create duplicate annotations for the same element.</li>
            <li>
              Do not use overly generic labels like &quot;Element 1&quot; or
              &quot;Thing&quot;.
            </li>
            <li>
              Do not leave bounding boxes that extend beyond the image
              boundaries.
            </li>
          </ul>
        </div>
      </div>
    </GuidelineSection>
  );
}
