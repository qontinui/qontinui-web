/**
 * AnnotatedImage Component - Usage Examples
 *
 * This file demonstrates various ways to use the AnnotatedImage component
 * with different annotation types and configurations.
 */

import { AnnotatedImage, Annotation } from "./annotated-image";

/**
 * Example 1: Basic highlight annotation
 * Shows how to highlight a region on an image
 */
export function BasicHighlightExample() {
  const annotations: Annotation[] = [
    {
      type: "highlight",
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      color: "cyan",
      opacity: 0.3,
    },
  ];

  return (
    <AnnotatedImage
      src="/tutorial/screenshot-1.png"
      alt="Tutorial step 1"
      annotations={annotations}
    />
  );
}

/**
 * Example 2: Multiple highlights with different colors
 * Demonstrates color variety and overlapping highlights
 */
export function MultipleHighlightsExample() {
  const annotations: Annotation[] = [
    {
      type: "highlight",
      x: 50,
      y: 50,
      width: 150,
      height: 100,
      color: "cyan",
      opacity: 0.25,
    },
    {
      type: "highlight",
      x: 300,
      y: 200,
      width: 180,
      height: 120,
      color: "green",
      opacity: 0.25,
    },
    {
      type: "highlight",
      x: 150,
      y: 400,
      width: 200,
      height: 80,
      color: "purple",
      opacity: 0.25,
    },
  ];

  return (
    <AnnotatedImage
      src="/tutorial/screenshot-1.png"
      alt="Tutorial step with multiple highlights"
      annotations={annotations}
    />
  );
}

/**
 * Example 3: Arrow annotations
 * Shows directional arrows pointing to specific elements
 */
export function ArrowAnnotationsExample() {
  const annotations: Annotation[] = [
    {
      type: "arrow",
      x: 200,
      y: 150,
      direction: "down",
      color: "cyan",
      size: "md",
    },
    {
      type: "arrow",
      x: 400,
      y: 300,
      direction: "left",
      color: "green",
      size: "lg",
    },
    {
      type: "arrow",
      x: 100,
      y: 500,
      direction: "up-right",
      color: "purple",
      size: "sm",
    },
  ];

  return (
    <AnnotatedImage
      src="/tutorial/screenshot-1.png"
      alt="Tutorial step with arrows"
      annotations={annotations}
    />
  );
}

/**
 * Example 4: Pulse annotations
 * Shows animated pulsing indicators
 */
export function PulseAnnotationsExample() {
  const annotations: Annotation[] = [
    {
      type: "pulse",
      x: 150,
      y: 150,
      color: "cyan",
      size: "sm",
      duration: 1500,
    },
    {
      type: "pulse",
      x: 350,
      y: 250,
      color: "green",
      size: "md",
      duration: 2000,
    },
    {
      type: "pulse",
      x: 200,
      y: 450,
      color: "purple",
      size: "lg",
      duration: 2500,
      delay: 500,
    },
  ];

  return (
    <AnnotatedImage
      src="/tutorial/screenshot-1.png"
      alt="Tutorial step with pulsing indicators"
      annotations={annotations}
    />
  );
}

/**
 * Example 5: Label annotations
 * Shows text labels pointing to areas
 */
export function LabelAnnotationsExample() {
  const annotations: Annotation[] = [
    {
      type: "label",
      x: 100,
      y: 80,
      label: "Toolbar",
      color: "cyan",
      size: "sm",
    },
    {
      type: "label",
      x: 300,
      y: 200,
      label: "Main Content Area",
      color: "green",
      size: "md",
    },
    {
      type: "label",
      x: 450,
      y: 500,
      label: "Submit Button",
      color: "purple",
      size: "sm",
    },
  ];

  return (
    <AnnotatedImage
      src="/tutorial/screenshot-1.png"
      alt="Tutorial step with labels"
      annotations={annotations}
    />
  );
}

/**
 * Example 6: Complete tutorial step
 * Shows a combination of all annotation types
 */
export function CompleteExampleStep1() {
  const annotations: Annotation[] = [
    // Highlight the main content area
    {
      type: "highlight",
      x: 100,
      y: 100,
      width: 300,
      height: 250,
      color: "cyan",
      opacity: 0.2,
    },

    // Arrow pointing to the toolbar
    {
      type: "arrow",
      x: 150,
      y: 60,
      direction: "down",
      color: "green",
      size: "md",
    },

    // Label for the toolbar
    {
      type: "label",
      x: 150,
      y: 30,
      label: "Top Navigation",
      color: "green",
      size: "sm",
    },

    // Pulse on the action button
    {
      type: "pulse",
      x: 450,
      y: 200,
      color: "purple",
      size: "md",
      duration: 2000,
    },

    // Label for the button
    {
      type: "label",
      x: 450,
      y: 160,
      label: "Click to Continue",
      color: "purple",
      size: "sm",
    },
  ];

  return (
    <AnnotatedImage
      src="/tutorial/screenshot-1.png"
      alt="Tutorial step 1: Complete example with all annotation types"
      annotations={annotations}
    />
  );
}

/**
 * Example 7: Responsive annotated image
 * Shows how to use custom styling with responsive behavior
 */
export function ResponsiveExampleWithCustomStyling() {
  const annotations: Annotation[] = [
    {
      type: "highlight",
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      color: "cyan",
      opacity: 0.25,
    },
    {
      type: "label",
      x: 200,
      y: 50,
      label: "Important Area",
      color: "cyan",
      size: "md",
    },
  ];

  return (
    <div className="max-w-2xl mx-auto">
      <AnnotatedImage
        src="/tutorial/screenshot-1.png"
        alt="Tutorial step with responsive styling"
        annotations={annotations}
        containerClassName="w-full"
        imageClassName="w-full h-auto border-2 border-qontinui-cyan/30"
      />
    </div>
  );
}

/**
 * Example 8: Step-by-step tutorial sequence
 * Shows how to create a multi-step tutorial
 */
export function TutorialSequenceExample() {
  const steps = [
    {
      title: "Step 1: Open the Automation Builder",
      image: "/tutorial/step-1.png",
      annotations: [
        {
          type: "highlight",
          x: 50,
          y: 50,
          width: 200,
          height: 100,
          color: "cyan",
          opacity: 0.25,
        },
        {
          type: "label",
          x: 150,
          y: 20,
          label: "Automation Builder",
          color: "cyan",
          size: "md",
        },
      ] as Annotation[],
    },
    {
      title: "Step 2: Define Your Actions",
      image: "/tutorial/step-2.png",
      annotations: [
        {
          type: "arrow",
          x: 200,
          y: 150,
          direction: "down",
          color: "green",
          size: "md",
        },
        {
          type: "label",
          x: 200,
          y: 120,
          label: "Add Actions",
          color: "green",
          size: "md",
        },
      ] as Annotation[],
    },
    {
      title: "Step 3: Run Your Automation",
      image: "/tutorial/step-3.png",
      annotations: [
        {
          type: "pulse",
          x: 400,
          y: 300,
          color: "purple",
          size: "lg",
          duration: 2000,
        },
        {
          type: "label",
          x: 400,
          y: 260,
          label: "Click Run",
          color: "purple",
          size: "md",
        },
      ] as Annotation[],
    },
  ];

  return (
    <div className="space-y-8">
      {steps.map((step, index) => (
        <div key={index} className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold mb-2">{step.title}</h3>
            <AnnotatedImage
              src={step.image}
              alt={step.title}
              annotations={step.annotations}
              containerClassName="w-full max-w-3xl"
              imageClassName="w-full h-auto"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Example 9: Interactive annotations with hover states
 * Shows how to combine annotations with custom styling
 */
export function InteractiveAnnotationsExample() {
  const annotations: Annotation[] = [
    {
      type: "highlight",
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      color: "cyan",
      opacity: 0.3,
    },
    {
      type: "pulse",
      x: 300,
      y: 200,
      color: "green",
      size: "md",
      duration: 2000,
    },
  ];

  return (
    <div className="relative">
      <AnnotatedImage
        src="/tutorial/screenshot-1.png"
        alt="Interactive tutorial"
        annotations={annotations}
        containerClassName="hover:shadow-2xl transition-shadow duration-300"
      />
      <p className="text-sm text-muted-foreground mt-4">
        Hover over the image to see the highlighted areas
      </p>
    </div>
  );
}

/**
 * Example 10: All arrow directions
 * Demonstrates all supported arrow directions
 */
export function AllArrowDirectionsExample() {
  const directions = [
    "up",
    "up-right",
    "right",
    "down-right",
    "down",
    "down-left",
    "left",
    "up-left",
  ] as const;

  const annotations: Annotation[] = directions.map((dir, i) => ({
    type: "arrow" as const,
    x: 300 + Math.cos((i * Math.PI) / 4) * 150,
    y: 200 + Math.sin((i * Math.PI) / 4) * 150,
    direction: dir,
    color: "cyan" as const,
    size: "md" as const,
  }));

  return (
    <AnnotatedImage
      src="/tutorial/screenshot-1.png"
      alt="All arrow directions"
      annotations={annotations}
    />
  );
}

/**
 * Example 11: Different pulse sizes with delays
 * Shows staggered pulse animations
 */
export function StaggeredPulsesExample() {
  const annotations: Annotation[] = [
    {
      type: "pulse",
      x: 100,
      y: 100,
      color: "cyan",
      size: "sm",
      duration: 2000,
      delay: 0,
    },
    {
      type: "pulse",
      x: 300,
      y: 200,
      color: "green",
      size: "md",
      duration: 2000,
      delay: 200,
    },
    {
      type: "pulse",
      x: 500,
      y: 300,
      color: "purple",
      size: "lg",
      duration: 2000,
      delay: 400,
    },
  ];

  return (
    <AnnotatedImage
      src="/tutorial/screenshot-1.png"
      alt="Staggered pulse animations"
      annotations={annotations}
    />
  );
}

/**
 * Example 12: Custom color combinations
 * Shows the range of available colors
 */
export function ColorVariationsExample() {
  const colors = ["cyan", "green", "purple", "red", "yellow", "blue"] as const;

  const annotations: Annotation[] = colors.map((color, i) => ({
    type: "pulse" as const,
    x: 100 + i * 100,
    y: 150,
    color: color,
    size: "md" as const,
    duration: 2000,
  }));

  return (
    <AnnotatedImage
      src="/tutorial/screenshot-1.png"
      alt="Color variations"
      annotations={annotations}
    />
  );
}
