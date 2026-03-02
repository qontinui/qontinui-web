/**
 * Getting Started guideline section content.
 */

import { GuidelineSection } from "./GuidelineSection";

export function GettingStartedSection() {
  return (
    <GuidelineSection title="1. Getting Started" defaultOpen={true}>
      <div className="space-y-4 text-sm">
        <div>
          <h4 className="font-medium text-text-primary mb-2">
            Using the Annotation Tools
          </h4>
          <ul className="list-disc list-inside space-y-1 text-text-secondary">
            <li>
              <strong>Select Tool (V):</strong> Click to select existing
              annotations. Hold Shift to select multiple elements.
            </li>
            <li>
              <strong>Draw Box Tool (B):</strong> Click and drag to draw a
              bounding box around UI elements.
            </li>
            <li>
              <strong>Delete Tool (D):</strong> Click on elements to delete
              them.
            </li>
            <li>
              <strong>Pan Tool (H):</strong> Click and drag to pan around the
              canvas.
            </li>
          </ul>
        </div>

        <div>
          <h4 className="font-medium text-text-primary mb-2">
            Selecting Elements
          </h4>
          <ul className="list-disc list-inside space-y-1 text-text-secondary">
            <li>
              Click on an annotation to select it and view its properties.
            </li>
            <li>Use Ctrl+A (Cmd+A on Mac) to select all visible elements.</li>
            <li>Press Escape to deselect all elements.</li>
            <li>Selected elements can be edited, deleted, or bulk-approved.</li>
          </ul>
        </div>

        <div>
          <h4 className="font-medium text-text-primary mb-2">
            Drawing Bounding Boxes
          </h4>
          <ul className="list-disc list-inside space-y-1 text-text-secondary">
            <li>
              Switch to the Draw Box tool (B) or click the box icon in the
              toolbar.
            </li>
            <li>
              Click at the top-left corner of the element and drag to the
              bottom-right.
            </li>
            <li>Release the mouse to complete the bounding box.</li>
            <li>
              The element type selector will appear - choose the appropriate
              type.
            </li>
          </ul>
        </div>
      </div>
    </GuidelineSection>
  );
}
