"use client";

import React from "react";

export const HowItWorksSection: React.FC = () => {
  return (
    <div className="mt-4 p-4 bg-surface-canvas rounded-lg border border-border-default">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* What it does */}
        <div>
          <h3 className="text-sm font-semibold text-white mb-2">
            What is Pattern Extraction?
          </h3>
          <p className="text-sm text-text-muted leading-relaxed">
            Pattern Extraction creates{" "}
            <strong className="text-text-secondary">
              masked image templates
            </strong>{" "}
            for UI automation. By comparing multiple screenshots of the same
            element, it identifies which pixels are{" "}
            <strong className="text-text-secondary">stable</strong> (always the
            same) vs <strong className="text-text-secondary">variable</strong>{" "}
            (change between screenshots). Variable pixels are made transparent,
            so they&apos;re ignored during matching.
          </p>
        </div>

        {/* Why use it */}
        <div>
          <h3 className="text-sm font-semibold text-white mb-2">
            Why Use This?
          </h3>
          <p className="text-sm text-text-muted leading-relaxed">
            Standard template matching fails when UI elements contain changing
            content - usernames, timestamps, notification counts, etc. Pattern
            Extraction creates templates that match the{" "}
            <strong className="text-text-secondary">structure</strong> of an
            element while ignoring its{" "}
            <strong className="text-text-secondary">dynamic content</strong>.
          </p>
        </div>

        {/* How to use */}
        <div>
          <h3 className="text-sm font-semibold text-white mb-2">How to Use</h3>
          <ol className="text-sm text-text-muted space-y-1.5 list-decimal list-inside">
            <li>
              Upload{" "}
              <strong className="text-text-secondary">2+ screenshots</strong>{" "}
              showing the same UI element with different content
            </li>
            <li>
              <strong className="text-text-secondary">Draw a region</strong>{" "}
              around the element you want to extract
            </li>
            <li>
              Adjust the{" "}
              <strong className="text-text-secondary">
                similarity threshold
              </strong>{" "}
              to control what&apos;s considered &quot;variable&quot;
            </li>
            <li>
              Click{" "}
              <strong className="text-text-secondary">Extract Pattern</strong>{" "}
              to generate the masked template
            </li>
            <li>
              Optionally edit the result, then{" "}
              <strong className="text-text-secondary">
                create a StateImage
              </strong>{" "}
              for use in automation
            </li>
          </ol>
        </div>

        {/* Understanding the output */}
        <div>
          <h3 className="text-sm font-semibold text-white mb-2">
            Understanding the Output
          </h3>
          <ul className="text-sm text-text-muted space-y-1.5">
            <li>
              <strong className="text-text-secondary">Pattern:</strong> The
              final template with variable areas made transparent (shown as
              checkerboard)
            </li>
            <li>
              <strong className="text-text-secondary">Confidence Map:</strong>{" "}
              Grayscale showing pixel stability - white = stable, black =
              variable
            </li>
            <li>
              <strong className="text-text-secondary">Mask:</strong> Binary
              version showing which pixels are included (white) or excluded
              (black)
            </li>
            <li>
              <strong className="text-text-secondary">Mask Density:</strong>{" "}
              Percentage of pixels kept - lower means more was masked out
            </li>
          </ul>
        </div>
      </div>

      {/* Example use cases */}
      <div className="mt-4 pt-4 border-t border-border-subtle">
        <h3 className="text-sm font-semibold text-white mb-2">
          Example Use Cases
        </h3>
        <div className="flex flex-wrap gap-2">
          {[
            "Buttons with dynamic labels",
            "Notification badges with counts",
            "User profile cards",
            "Status indicators",
            "Navigation items with badges",
            "Form fields with placeholder text",
          ].map((useCase) => (
            <span
              key={useCase}
              className="px-2 py-1 text-xs bg-surface-raised text-text-secondary rounded-md"
            >
              {useCase}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
