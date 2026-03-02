import type { Annotation } from "../annotated-image";

export const basicHighlightAnnotations: Annotation[] = [
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

export const multipleHighlightsAnnotations: Annotation[] = [
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

export const arrowAnnotations: Annotation[] = [
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

export const pulseAnnotations: Annotation[] = [
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

export const labelAnnotations: Annotation[] = [
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

export const completeStep1Annotations: Annotation[] = [
  {
    type: "highlight",
    x: 100,
    y: 100,
    width: 300,
    height: 250,
    color: "cyan",
    opacity: 0.2,
  },
  {
    type: "arrow",
    x: 150,
    y: 60,
    direction: "down",
    color: "green",
    size: "md",
  },
  {
    type: "label",
    x: 150,
    y: 30,
    label: "Top Navigation",
    color: "green",
    size: "sm",
  },
  {
    type: "pulse",
    x: 450,
    y: 200,
    color: "purple",
    size: "md",
    duration: 2000,
  },
  {
    type: "label",
    x: 450,
    y: 160,
    label: "Click to Continue",
    color: "purple",
    size: "sm",
  },
];

export const responsiveAnnotations: Annotation[] = [
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

export interface TutorialStep {
  title: string;
  image: string;
  annotations: Annotation[];
}

export const tutorialSequenceSteps: TutorialStep[] = [
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
    ],
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
    ],
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
    ],
  },
];

export const interactiveAnnotations: Annotation[] = [
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

const ARROW_DIRECTIONS = [
  "up",
  "up-right",
  "right",
  "down-right",
  "down",
  "down-left",
  "left",
  "up-left",
] as const;

export const allArrowAnnotations: Annotation[] = ARROW_DIRECTIONS.map(
  (dir, i) => ({
    type: "arrow" as const,
    x: 300 + Math.cos((i * Math.PI) / 4) * 150,
    y: 200 + Math.sin((i * Math.PI) / 4) * 150,
    direction: dir,
    color: "cyan" as const,
    size: "md" as const,
  })
);

export const staggeredPulseAnnotations: Annotation[] = [
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

const ANNOTATION_COLORS = [
  "cyan",
  "green",
  "purple",
  "red",
  "yellow",
  "blue",
] as const;

export const colorVariationAnnotations: Annotation[] = ANNOTATION_COLORS.map(
  (color, i) => ({
    type: "pulse" as const,
    x: 100 + i * 100,
    y: 150,
    color: color,
    size: "md" as const,
    duration: 2000,
  })
);
