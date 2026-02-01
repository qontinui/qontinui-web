/**
 * Annotation Guidelines Dialog
 *
 * In-app documentation for annotators with comprehensive guidelines on:
 * - Getting started with annotation tools
 * - Element type descriptions
 * - Best practices for quality annotations
 * - Quality guidelines and standards
 */

"use client";

import { useState } from "react";
import { BookOpen, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface GuidelineSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function GuidelineSection({
  title,
  children,
  defaultOpen = false,
}: GuidelineSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center justify-between w-full p-3 rounded-lg bg-surface-canvas hover:bg-surface-raised border border-border-subtle transition-colors text-left">
          <span className="font-medium text-text-primary">{title}</span>
          <ChevronRight
            className={`h-4 w-4 text-text-muted transition-transform ${
              isOpen ? "rotate-90" : ""
            }`}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-4 pt-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

interface ElementTypeItemProps {
  type: string;
  description: string;
  color?: string;
}

function ElementTypeItem({ type, description, color }: ElementTypeItemProps) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Badge
        variant="outline"
        className="shrink-0 min-w-[100px] justify-center"
        style={color ? { borderColor: color, color } : undefined}
      >
        {type}
      </Badge>
      <span className="text-sm text-text-secondary">{description}</span>
    </div>
  );
}

interface AnnotationGuidelinesDialogProps {
  trigger?: React.ReactNode;
}

export function AnnotationGuidelinesDialog({
  trigger,
}: AnnotationGuidelinesDialogProps) {
  const [open, setOpen] = useState(false);

  const elementTypes: ElementTypeItemProps[] = [
    {
      type: "Button",
      description:
        "Interactive clickable elements that trigger actions, such as submit buttons, toggle buttons, or action buttons.",
      color: "#3B82F6",
    },
    {
      type: "Input Field",
      description:
        "Text input areas where users can type, including single-line inputs, password fields, and search boxes.",
      color: "#10B981",
    },
    {
      type: "Link",
      description:
        "Clickable navigation elements that lead to other pages or sections, typically styled as text with underlines or distinct colors.",
      color: "#8B5CF6",
    },
    {
      type: "Icon",
      description:
        "Visual indicators or icon buttons that convey meaning or provide clickable actions, such as menu icons, status indicators, or action icons.",
      color: "#F59E0B",
    },
    {
      type: "Label/Text",
      description:
        "Static text content including headings, paragraphs, captions, and any non-interactive text displayed on the interface.",
      color: "#6B7280",
    },
    {
      type: "Container",
      description:
        "Grouping elements that organize other UI components, such as cards, panels, sections, or modal dialogs.",
      color: "#EC4899",
    },
    {
      type: "Checkbox",
      description:
        "Toggle inputs that allow users to select multiple options, represented by a square box that can be checked or unchecked.",
      color: "#14B8A6",
    },
    {
      type: "Radio Button",
      description:
        "Single-select options within a group, represented by circular buttons where only one can be selected at a time.",
      color: "#F97316",
    },
    {
      type: "Dropdown",
      description:
        "Select menus that expand to show a list of options, allowing users to choose one or more items from the list.",
      color: "#06B6D4",
    },
    {
      type: "Menu",
      description:
        "Navigation menus including horizontal nav bars, vertical sidebars, hamburger menus, and context menus.",
      color: "#84CC16",
    },
    {
      type: "Tab",
      description:
        "Tab navigation elements that switch between different views or content sections within the same container.",
      color: "#A855F7",
    },
    {
      type: "Image",
      description:
        "Visual content including photos, illustrations, diagrams, and any non-icon graphical elements.",
      color: "#EF4444",
    },
    {
      type: "Other",
      description:
        "Miscellaneous elements that do not fit into the above categories, such as sliders, progress bars, or custom widgets.",
      color: "#78716C",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm">
            <BookOpen className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-[#9B59B6]" />
            Annotation Guidelines
          </DialogTitle>
          <DialogDescription>
            Reference guide for creating high-quality UI element annotations.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-3 py-4">
            {/* Getting Started */}
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
                      <strong>Draw Box Tool (B):</strong> Click and drag to draw
                      a bounding box around UI elements.
                    </li>
                    <li>
                      <strong>Delete Tool (D):</strong> Click on elements to
                      delete them.
                    </li>
                    <li>
                      <strong>Pan Tool (H):</strong> Click and drag to pan
                      around the canvas.
                    </li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-medium text-text-primary mb-2">
                    Selecting Elements
                  </h4>
                  <ul className="list-disc list-inside space-y-1 text-text-secondary">
                    <li>
                      Click on an annotation to select it and view its
                      properties.
                    </li>
                    <li>
                      Use Ctrl+A (Cmd+A on Mac) to select all visible elements.
                    </li>
                    <li>Press Escape to deselect all elements.</li>
                    <li>
                      Selected elements can be edited, deleted, or bulk-approved.
                    </li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-medium text-text-primary mb-2">
                    Drawing Bounding Boxes
                  </h4>
                  <ul className="list-disc list-inside space-y-1 text-text-secondary">
                    <li>
                      Switch to the Draw Box tool (B) or click the box icon in
                      the toolbar.
                    </li>
                    <li>
                      Click at the top-left corner of the element and drag to
                      the bottom-right.
                    </li>
                    <li>
                      Release the mouse to complete the bounding box.
                    </li>
                    <li>
                      The element type selector will appear - choose the
                      appropriate type.
                    </li>
                  </ul>
                </div>
              </div>
            </GuidelineSection>

            {/* Element Types */}
            <GuidelineSection title="2. Element Types">
              <div className="space-y-1">
                {elementTypes.map((element) => (
                  <ElementTypeItem key={element.type} {...element} />
                ))}
              </div>
            </GuidelineSection>

            {/* Best Practices */}
            <GuidelineSection title="3. Best Practices">
              <div className="space-y-4 text-sm">
                <div>
                  <h4 className="font-medium text-text-primary mb-2">
                    Draw Tight Bounding Boxes
                  </h4>
                  <p className="text-text-secondary">
                    Bounding boxes should closely fit the visible boundaries of
                    the element. Avoid including excessive padding or
                    surrounding whitespace. The box should touch the outermost
                    pixels of the element on all sides.
                  </p>
                </div>

                <div>
                  <h4 className="font-medium text-text-primary mb-2">
                    Use Descriptive Labels
                  </h4>
                  <p className="text-text-secondary">
                    When adding custom labels, use clear and descriptive names
                    that identify the element&apos;s purpose. For example, use
                    &quot;Submit Button&quot; instead of just &quot;Button&quot;, or &quot;Email Input
                    Field&quot; instead of &quot;Input&quot;.
                  </p>
                </div>

                <div>
                  <h4 className="font-medium text-text-primary mb-2">
                    Mark Verified Elements as Ground Truth
                  </h4>
                  <p className="text-text-secondary">
                    After verifying an annotation is correct, mark it as Ground
                    Truth. Ground Truth elements are used for training ML models
                    and should represent the highest quality annotations in your
                    dataset.
                  </p>
                </div>

                <div>
                  <h4 className="font-medium text-text-primary mb-2">
                    Add Reasoning for Important Elements
                  </h4>
                  <p className="text-text-secondary">
                    For complex or ambiguous elements, add reasoning notes
                    explaining why you classified it a certain way. This helps
                    other reviewers understand your decisions and maintains
                    consistency.
                  </p>
                </div>

                <div>
                  <h4 className="font-medium text-text-primary mb-2">
                    Review and Approve Annotations
                  </h4>
                  <p className="text-text-secondary">
                    Use the review workflow to approve or reject annotations.
                    Approved annotations indicate they have been verified by a
                    human reviewer. Rejected annotations should include feedback
                    for correction.
                  </p>
                </div>
              </div>
            </GuidelineSection>

            {/* Quality Guidelines */}
            <GuidelineSection title="4. Quality Guidelines">
              <div className="space-y-4 text-sm">
                <div>
                  <h4 className="font-medium text-text-primary mb-2">
                    Minimum Bounding Box Size
                  </h4>
                  <p className="text-text-secondary">
                    Bounding boxes should be at least 10x10 pixels. Very small
                    annotations may be difficult to detect and train models on.
                    If an element is smaller than this threshold, consider
                    whether it should be annotated at all.
                  </p>
                </div>

                <div>
                  <h4 className="font-medium text-text-primary mb-2">
                    Handling Overlapping Elements
                  </h4>
                  <ul className="list-disc list-inside space-y-1 text-text-secondary">
                    <li>
                      <strong>Nested elements:</strong> Annotate both the
                      container and its children separately (e.g., a card
                      container and buttons inside it).
                    </li>
                    <li>
                      <strong>Partially overlapping:</strong> Draw boxes that
                      accurately represent each element&apos;s boundaries, even if
                      they overlap.
                    </li>
                    <li>
                      <strong>Stacked elements:</strong> Annotate visible
                      elements only. Do not annotate elements hidden behind
                      others.
                    </li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-medium text-text-primary mb-2">
                    When to Use Each Element Type
                  </h4>
                  <ul className="list-disc list-inside space-y-1 text-text-secondary">
                    <li>
                      Use <strong>Button</strong> for elements that perform
                      actions when clicked (submit, save, cancel).
                    </li>
                    <li>
                      Use <strong>Link</strong> for elements that navigate to
                      other pages or locations.
                    </li>
                    <li>
                      Use <strong>Icon</strong> only for standalone icons or
                      icon buttons, not icons within buttons.
                    </li>
                    <li>
                      Use <strong>Container</strong> for grouping elements; do
                      not use for single elements.
                    </li>
                    <li>
                      Use <strong>Other</strong> sparingly - try to find a more
                      specific type first.
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
                    <li>
                      Do not annotate disabled or invisible elements.
                    </li>
                    <li>
                      Do not create duplicate annotations for the same element.
                    </li>
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

            {/* Keyboard Shortcuts */}
            <GuidelineSection title="5. Keyboard Shortcuts">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between p-2 bg-surface-canvas rounded">
                  <span className="text-text-secondary">Select Tool</span>
                  <kbd className="px-2 py-0.5 bg-surface-raised rounded text-xs font-mono">
                    V
                  </kbd>
                </div>
                <div className="flex justify-between p-2 bg-surface-canvas rounded">
                  <span className="text-text-secondary">Draw Box Tool</span>
                  <kbd className="px-2 py-0.5 bg-surface-raised rounded text-xs font-mono">
                    B
                  </kbd>
                </div>
                <div className="flex justify-between p-2 bg-surface-canvas rounded">
                  <span className="text-text-secondary">Delete Tool</span>
                  <kbd className="px-2 py-0.5 bg-surface-raised rounded text-xs font-mono">
                    D
                  </kbd>
                </div>
                <div className="flex justify-between p-2 bg-surface-canvas rounded">
                  <span className="text-text-secondary">Pan Tool</span>
                  <kbd className="px-2 py-0.5 bg-surface-raised rounded text-xs font-mono">
                    H
                  </kbd>
                </div>
                <div className="flex justify-between p-2 bg-surface-canvas rounded">
                  <span className="text-text-secondary">Undo</span>
                  <kbd className="px-2 py-0.5 bg-surface-raised rounded text-xs font-mono">
                    Ctrl+Z
                  </kbd>
                </div>
                <div className="flex justify-between p-2 bg-surface-canvas rounded">
                  <span className="text-text-secondary">Redo</span>
                  <kbd className="px-2 py-0.5 bg-surface-raised rounded text-xs font-mono">
                    Ctrl+Y
                  </kbd>
                </div>
                <div className="flex justify-between p-2 bg-surface-canvas rounded">
                  <span className="text-text-secondary">Select All</span>
                  <kbd className="px-2 py-0.5 bg-surface-raised rounded text-xs font-mono">
                    Ctrl+A
                  </kbd>
                </div>
                <div className="flex justify-between p-2 bg-surface-canvas rounded">
                  <span className="text-text-secondary">Deselect</span>
                  <kbd className="px-2 py-0.5 bg-surface-raised rounded text-xs font-mono">
                    Esc
                  </kbd>
                </div>
                <div className="flex justify-between p-2 bg-surface-canvas rounded">
                  <span className="text-text-secondary">Copy</span>
                  <kbd className="px-2 py-0.5 bg-surface-raised rounded text-xs font-mono">
                    Ctrl+C
                  </kbd>
                </div>
                <div className="flex justify-between p-2 bg-surface-canvas rounded">
                  <span className="text-text-secondary">Cut</span>
                  <kbd className="px-2 py-0.5 bg-surface-raised rounded text-xs font-mono">
                    Ctrl+X
                  </kbd>
                </div>
                <div className="flex justify-between p-2 bg-surface-canvas rounded">
                  <span className="text-text-secondary">Paste</span>
                  <kbd className="px-2 py-0.5 bg-surface-raised rounded text-xs font-mono">
                    Ctrl+V
                  </kbd>
                </div>
                <div className="flex justify-between p-2 bg-surface-canvas rounded">
                  <span className="text-text-secondary">Save</span>
                  <kbd className="px-2 py-0.5 bg-surface-raised rounded text-xs font-mono">
                    Ctrl+S
                  </kbd>
                </div>
                <div className="flex justify-between p-2 bg-surface-canvas rounded">
                  <span className="text-text-secondary">Toggle Grid</span>
                  <kbd className="px-2 py-0.5 bg-surface-raised rounded text-xs font-mono">
                    Ctrl+G
                  </kbd>
                </div>
              </div>
            </GuidelineSection>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
