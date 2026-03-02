export type AnnotationType = "highlight" | "arrow" | "pulse" | "label";

export type AnnotationColor =
  | "cyan"
  | "green"
  | "purple"
  | "red"
  | "yellow"
  | "blue";

export type ArrowDirection =
  | "up"
  | "down"
  | "left"
  | "right"
  | "up-left"
  | "up-right"
  | "down-left"
  | "down-right";

export interface Annotation {
  type: AnnotationType;
  x: number;
  y: number;
  width?: number;
  height?: number;
  color?: AnnotationColor;
  label?: string;
  size?: "sm" | "md" | "lg";
  direction?: ArrowDirection;
  opacity?: number;
  duration?: number;
  delay?: number;
}

export interface AnnotatedImageProps {
  src: string;
  alt: string;
  annotations: Annotation[];
  className?: string;
  imageClassName?: string;
  containerClassName?: string;
}

export const COLOR_MAP: Record<
  AnnotationColor,
  { bg: string; text: string; border: string; ring: string }
> = {
  cyan: {
    bg: "bg-brand-primary/20",
    text: "text-brand-primary",
    border: "border-brand-primary",
    ring: "ring-brand-primary",
  },
  green: {
    bg: "bg-brand-success/20",
    text: "text-brand-success",
    border: "border-brand-success",
    ring: "ring-brand-success",
  },
  purple: {
    bg: "bg-brand-secondary/20",
    text: "text-brand-secondary",
    border: "border-brand-secondary",
    ring: "ring-brand-secondary",
  },
  red: {
    bg: "bg-red-500/20",
    text: "text-red-500",
    border: "border-red-500",
    ring: "ring-red-500",
  },
  yellow: {
    bg: "bg-yellow-500/20",
    text: "text-yellow-500",
    border: "border-yellow-500",
    ring: "ring-yellow-500",
  },
  blue: {
    bg: "bg-blue-500/20",
    text: "text-blue-500",
    border: "border-blue-500",
    ring: "ring-blue-500",
  },
};

export const SIZE_MAP: Record<
  string,
  { pulse: number; arrow: number; label: string }
> = {
  sm: { pulse: 16, arrow: 24, label: "text-xs" },
  md: { pulse: 24, arrow: 32, label: "text-sm" },
  lg: { pulse: 32, arrow: 40, label: "text-base" },
};

export const COLOR_HEX_MAP: Record<AnnotationColor, string> = {
  cyan: "#4A90D9",
  green: "#4DB89D",
  purple: "#8B6BB5",
  red: "#ef4444",
  yellow: "#eab308",
  blue: "#3b82f6",
};

export const ARROW_ROTATION_MAP: Record<ArrowDirection, number> = {
  up: 0,
  "up-right": 45,
  right: 90,
  "down-right": 135,
  down: 180,
  "down-left": 225,
  left: 270,
  "up-left": 315,
};

export const PULSE_ANIMATION_STYLES = `
  @keyframes annotated-image-pulse {
    0%, 100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.5;
      transform: scale(1.2);
    }
  }

  @keyframes annotated-image-pulse-ring {
    0% {
      transform: scale(1);
      opacity: 1;
    }
    100% {
      transform: scale(1.5);
      opacity: 0;
    }
  }

  .annotated-image-pulse {
    animation: annotated-image-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }

  .annotated-image-pulse-ring {
    animation: annotated-image-pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }
`;
