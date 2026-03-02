import { TryItButton } from "./try-it-button";
import { ExampleSection } from "./_components/ExampleSection";
import { CompleteTutorialWorkflowExample } from "./_components/CompleteTutorialWorkflowExample";
import {
  simpleUploadConfig,
  singleHintConfig,
  multipleHintsConfig,
  preloadedDataConfig,
  successCriteriaConfig,
  completeAutomationConfig,
  optionalTestingConfig,
  patternDebuggingConfig,
  optimizationConfig,
  edgeCaseConfigs,
} from "./data/try-it-example-configs";

export function SimpleUploadScreenshotExample() {
  return (
    <ExampleSection title="Example 1: Simple Screenshot Upload">
      <TryItButton config={simpleUploadConfig} />
    </ExampleSection>
  );
}

export function ExerciseWithHintExample() {
  return (
    <ExampleSection title="Example 2: Exercise with Hint">
      <TryItButton config={singleHintConfig} />
    </ExampleSection>
  );
}

export function MultipleHintsExample() {
  return (
    <ExampleSection title="Example 3: Multiple Hints with Navigation">
      <TryItButton
        config={multipleHintsConfig}
        onComplete={(result) => {
          console.log("Action created:", result);
        }}
      />
    </ExampleSection>
  );
}

export function PreloadedDataExample() {
  return (
    <ExampleSection title="Example 4: Preloaded Data">
      <TryItButton config={preloadedDataConfig} />
    </ExampleSection>
  );
}

export function SuccessCriteriaExample() {
  return (
    <ExampleSection title="Example 5: Success Criteria">
      <TryItButton config={successCriteriaConfig} />
    </ExampleSection>
  );
}

export function CompleteAutomationExample() {
  return (
    <ExampleSection title="Example 6: Complete Automation Configuration">
      <TryItButton
        config={completeAutomationConfig}
        onComplete={(result) => {
          console.log("Automation configured:", result);
        }}
      />
    </ExampleSection>
  );
}

export function OptionalTestingExerciseExample() {
  return (
    <ExampleSection title="Example 7: Optional Testing Exercise">
      <div className="p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <p className="text-sm text-blue-900 dark:text-blue-100 mb-4">
          This exercise is optional. You can skip it and continue to the next
          step.
        </p>
        <TryItButton config={optionalTestingConfig} />
      </div>
    </ExampleSection>
  );
}

export function PatternDebuggingExample() {
  return (
    <ExampleSection title="Example 8: Pattern Debugging">
      <TryItButton config={patternDebuggingConfig} />
    </ExampleSection>
  );
}

export function OptimizationExerciseExample() {
  return (
    <ExampleSection title="Example 9: Automation Optimization">
      <TryItButton config={optimizationConfig} />
    </ExampleSection>
  );
}

export { CompleteTutorialWorkflowExample };

export function EdgeCasesExample() {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold">
        Example 11: Edge Cases and Error Handling
      </h3>
      {edgeCaseConfigs.map((item) => (
        <div key={item.label} className="space-y-3">
          <h4 className="font-semibold text-sm">{item.label}</h4>
          <TryItButton config={item.config} />
        </div>
      ))}
    </div>
  );
}
