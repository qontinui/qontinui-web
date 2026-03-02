import { AnnotatedImage } from "../annotated-image";
import type { TutorialStep } from "../data/annotated-image-examples";

interface TutorialSequenceExampleProps {
  steps: TutorialStep[];
}

export function TutorialSequenceExample({
  steps,
}: TutorialSequenceExampleProps) {
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
