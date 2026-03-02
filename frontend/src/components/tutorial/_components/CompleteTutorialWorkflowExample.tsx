import { TryItButton } from "../try-it-button";
import { tutorialWorkflowSteps } from "../data/try-it-example-configs";

export function CompleteTutorialWorkflowExample() {
  return (
    <div className="space-y-12">
      <div>
        <h3 className="text-lg font-semibold mb-4">
          Tutorial: Create Your First Game Automation
        </h3>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          This tutorial walks you through creating a complete automation for
          Civilization VI.
        </p>
      </div>

      {tutorialWorkflowSteps.map((step) => (
        <div key={step.title} className="space-y-4">
          <h4 className="font-semibold text-md">{step.title}</h4>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {step.description}
          </p>
          <TryItButton config={step.config} />
        </div>
      ))}

      <div className="p-6 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg">
        <h4 className="font-semibold text-green-900 dark:text-green-100 mb-2">
          Congratulations!
        </h4>
        <p className="text-green-800 dark:text-green-200">
          You&apos;ve successfully created your first game automation! You can
          now use this automation in Qontinui to automate your gameplay.
        </p>
      </div>
    </div>
  );
}
