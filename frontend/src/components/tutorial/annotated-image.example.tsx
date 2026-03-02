import { AnnotatedImage } from "./annotated-image";
import { TutorialSequenceExample } from "./_components/TutorialSequenceExample";
import {
  basicHighlightAnnotations,
  multipleHighlightsAnnotations,
  arrowAnnotations,
  pulseAnnotations,
  labelAnnotations,
  completeStep1Annotations,
  responsiveAnnotations,
  tutorialSequenceSteps,
  interactiveAnnotations,
  allArrowAnnotations,
  staggeredPulseAnnotations,
  colorVariationAnnotations,
} from "./data/annotated-image-examples";

export function BasicHighlightExample() {
  return (
    <AnnotatedImage
      src="/tutorial/screenshot-1.png"
      alt="Tutorial step 1"
      annotations={basicHighlightAnnotations}
    />
  );
}

export function MultipleHighlightsExample() {
  return (
    <AnnotatedImage
      src="/tutorial/screenshot-1.png"
      alt="Tutorial step with multiple highlights"
      annotations={multipleHighlightsAnnotations}
    />
  );
}

export function ArrowAnnotationsExample() {
  return (
    <AnnotatedImage
      src="/tutorial/screenshot-1.png"
      alt="Tutorial step with arrows"
      annotations={arrowAnnotations}
    />
  );
}

export function PulseAnnotationsExample() {
  return (
    <AnnotatedImage
      src="/tutorial/screenshot-1.png"
      alt="Tutorial step with pulsing indicators"
      annotations={pulseAnnotations}
    />
  );
}

export function LabelAnnotationsExample() {
  return (
    <AnnotatedImage
      src="/tutorial/screenshot-1.png"
      alt="Tutorial step with labels"
      annotations={labelAnnotations}
    />
  );
}

export function CompleteExampleStep1() {
  return (
    <AnnotatedImage
      src="/tutorial/screenshot-1.png"
      alt="Tutorial step 1: Complete example with all annotation types"
      annotations={completeStep1Annotations}
    />
  );
}

export function ResponsiveExampleWithCustomStyling() {
  return (
    <div className="max-w-2xl mx-auto">
      <AnnotatedImage
        src="/tutorial/screenshot-1.png"
        alt="Tutorial step with responsive styling"
        annotations={responsiveAnnotations}
        containerClassName="w-full"
        imageClassName="w-full h-auto border-2 border-brand-primary/30"
      />
    </div>
  );
}

export function TutorialSequence() {
  return <TutorialSequenceExample steps={tutorialSequenceSteps} />;
}

export function InteractiveAnnotationsExample() {
  return (
    <div className="relative">
      <AnnotatedImage
        src="/tutorial/screenshot-1.png"
        alt="Interactive tutorial"
        annotations={interactiveAnnotations}
        containerClassName="hover:shadow-2xl transition-shadow duration-300"
      />
      <p className="text-sm text-muted-foreground mt-4">
        Hover over the image to see the highlighted areas
      </p>
    </div>
  );
}

export function AllArrowDirectionsExample() {
  return (
    <AnnotatedImage
      src="/tutorial/screenshot-1.png"
      alt="All arrow directions"
      annotations={allArrowAnnotations}
    />
  );
}

export function StaggeredPulsesExample() {
  return (
    <AnnotatedImage
      src="/tutorial/screenshot-1.png"
      alt="Staggered pulse animations"
      annotations={staggeredPulseAnnotations}
    />
  );
}

export function ColorVariationsExample() {
  return (
    <AnnotatedImage
      src="/tutorial/screenshot-1.png"
      alt="Color variations"
      annotations={colorVariationAnnotations}
    />
  );
}
