/**
 * Best Practices guideline section content.
 */

import { GuidelineSection } from "./GuidelineSection";

export function BestPracticesSection() {
  return (
    <GuidelineSection title="3. Best Practices">
      <div className="space-y-4 text-sm">
        <div>
          <h4 className="font-medium text-text-primary mb-2">
            Draw Tight Bounding Boxes
          </h4>
          <p className="text-text-secondary">
            Bounding boxes should closely fit the visible boundaries of the
            element. Avoid including excessive padding or surrounding
            whitespace. The box should touch the outermost pixels of the element
            on all sides.
          </p>
        </div>

        <div>
          <h4 className="font-medium text-text-primary mb-2">
            Use Descriptive Labels
          </h4>
          <p className="text-text-secondary">
            When adding custom labels, use clear and descriptive names that
            identify the element&apos;s purpose. For example, use &quot;Submit
            Button&quot; instead of just &quot;Button&quot;, or &quot;Email
            Input Field&quot; instead of &quot;Input&quot;.
          </p>
        </div>

        <div>
          <h4 className="font-medium text-text-primary mb-2">
            Mark Verified Elements as Ground Truth
          </h4>
          <p className="text-text-secondary">
            After verifying an annotation is correct, mark it as Ground Truth.
            Ground Truth elements are used for training ML models and should
            represent the highest quality annotations in your dataset.
          </p>
        </div>

        <div>
          <h4 className="font-medium text-text-primary mb-2">
            Add Reasoning for Important Elements
          </h4>
          <p className="text-text-secondary">
            For complex or ambiguous elements, add reasoning notes explaining
            why you classified it a certain way. This helps other reviewers
            understand your decisions and maintains consistency.
          </p>
        </div>

        <div>
          <h4 className="font-medium text-text-primary mb-2">
            Review and Approve Annotations
          </h4>
          <p className="text-text-secondary">
            Use the review workflow to approve or reject annotations. Approved
            annotations indicate they have been verified by a human reviewer.
            Rejected annotations should include feedback for correction.
          </p>
        </div>
      </div>
    </GuidelineSection>
  );
}
