'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCreateProject } from '@/hooks/use-projects';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Progress } from '@/components/ui/progress';
import {
  Rocket,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  FileText,
  Target,
  CheckCircle2,
  Gamepad2,
  Briefcase,
  TestTube,
  Compass,
  Layout,
  Bot,
  MousePointer,
  X
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface FirstProjectWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

interface WizardState {
  projectName: string;
  projectDescription: string;
  selectedTemplate: 'blank' | 'civ6' | 'clicker';
  useCase: 'gaming' | 'productivity' | 'testing' | 'exploring';
}

interface TemplateOption {
  id: 'blank' | 'civ6' | 'clicker';
  name: string;
  description: string;
  icon: typeof Layout;
}

const TOTAL_STEPS = 5;

const templates: TemplateOption[] = [
  {
    id: 'blank',
    name: 'Blank Project',
    description: 'Start from scratch with an empty canvas',
    icon: Layout,
  },
  {
    id: 'civ6',
    name: 'Civ 6 Unit Manager',
    description: 'Pre-configured for Civilization VI automation',
    icon: Bot,
  },
  {
    id: 'clicker',
    name: 'Simple Clicker',
    description: 'Basic click automation example',
    icon: MousePointer,
  },
];

export function FirstProjectWizard({ open, onOpenChange, onComplete }: FirstProjectWizardProps) {
  const router = useRouter();
  const createProject = useCreateProject();

  const [currentStep, setCurrentStep] = useState(1);
  const [wizardState, setWizardState] = useState<WizardState>({
    projectName: '',
    projectDescription: '',
    selectedTemplate: 'blank',
    useCase: 'gaming',
  });

  // Save progress to localStorage
  useEffect(() => {
    if (open && typeof window !== 'undefined') {
      const savedState = localStorage.getItem('first-project-wizard-state');
      if (savedState) {
        try {
          const parsed = JSON.parse(savedState);
          setWizardState(parsed.wizardState || wizardState);
          setCurrentStep(parsed.currentStep || 1);
        } catch (e) {
          console.error('Failed to parse saved wizard state:', e);
        }
      }
    }
  }, [open]);

  useEffect(() => {
    if (open && typeof window !== 'undefined') {
      localStorage.setItem('first-project-wizard-state', JSON.stringify({
        currentStep,
        wizardState,
      }));
    }
  }, [currentStep, wizardState, open]);

  const updateState = (updates: Partial<WizardState>) => {
    setWizardState(prev => ({ ...prev, ...updates }));
  };

  const handleNext = () => {
    // Validate current step
    if (currentStep === 2 && !wizardState.projectName.trim()) {
      toast.error('Please enter a project name');
      return;
    }

    if (currentStep < TOTAL_STEPS) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleSkip = () => {
    // Create a default project
    handleCreateProject({
      name: 'My First Automation',
      description: 'Getting started with Qontinui',
      template: 'blank',
    });
  };

  const handleCreateProject = async (config?: { name: string; description: string; template: string }) => {
    try {
      const projectConfig = config || {
        name: wizardState.projectName || 'My First Automation',
        description: wizardState.projectDescription || 'Created with First Project Wizard',
        template: wizardState.selectedTemplate,
      };

      const newProject = await createProject.mutateAsync({
        name: projectConfig.name,
        description: projectConfig.description,
        configuration: {
          template: projectConfig.template,
          useCase: wizardState.useCase,
          isFirstProject: true,
        },
      });

      // Clear saved wizard state
      if (typeof window !== 'undefined') {
        localStorage.removeItem('first-project-wizard-state');
        localStorage.setItem('hasCreatedFirstProject', 'true');
      }

      // Close wizard
      onOpenChange(false);

      // Call completion callback if provided
      if (onComplete) {
        onComplete();
      }

      // Show success toast
      toast.success('Project created successfully!');

      // Navigate to automation builder
      router.push(`/automation-builder?project=${newProject.id}`);
    } catch (error: any) {
      console.error('Failed to create project:', error);
      toast.error(error.message || 'Failed to create project');
    }
  };

  const handleClose = () => {
    // Save state before closing
    onOpenChange(false);
  };

  const handleOpenProject = () => {
    handleCreateProject();
  };

  const handleWatchTutorial = () => {
    // Create project first
    handleCreateProject();
    // Tutorial link would open here (future enhancement)
    toast.info('Tutorial feature coming soon!');
  };

  const handleSuggestion = (name: string) => {
    updateState({ projectName: name });
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return;

      if (e.key === 'Enter' && currentStep !== TOTAL_STEPS) {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, currentStep, wizardState]);

  const progressPercentage = (currentStep / TOTAL_STEPS) * 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] border-gray-800 text-white"
        showCloseButton={false}
      >
        {/* Header with Progress */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] bg-clip-text text-transparent">
                First Project Wizard
              </DialogTitle>
              <DialogDescription className="text-gray-400">
                Step {currentStep} of {TOTAL_STEPS}
              </DialogDescription>
            </DialogHeader>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              className="text-gray-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>

          {/* Progress Bar */}
          <div className="space-y-2">
            <Progress
              value={progressPercentage}
              className="h-2 bg-gray-800"
            />
            <div className="flex justify-between text-xs text-gray-500">
              <span>Welcome</span>
              <span>Name</span>
              <span>Template</span>
              <span>Use Case</span>
              <span>Ready!</span>
            </div>
          </div>
        </div>

        {/* Step Content */}
        <div className="py-8 min-h-[400px]">
          {/* Step 1: Welcome */}
          {currentStep === 1 && (
            <div className="text-center space-y-6">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-[#00D9FF]/20 to-[#BD00FF]/20 rounded-full border border-[#00D9FF]/30">
                <Rocket className="w-10 h-10 text-[#00D9FF]" />
              </div>
              <div className="space-y-3">
                <h2 className="text-3xl font-bold">Let's Create Your First Automation</h2>
                <p className="text-lg text-gray-400 max-w-2xl mx-auto">
                  We'll guide you through building a simple automation step-by-step
                </p>
              </div>
              <div className="bg-[#1A1A1B]/50 border border-gray-800 rounded-lg p-6 max-w-xl mx-auto">
                <div className="flex items-start gap-4 text-left">
                  <Sparkles className="w-6 h-6 text-[#BD00FF] flex-shrink-0 mt-1" />
                  <div>
                    <h3 className="font-semibold mb-2">What is Automation?</h3>
                    <p className="text-sm text-gray-400">
                      Automations are visual workflows that perform repetitive tasks for you.
                      Using state machines and image recognition, you can automate games,
                      business processes, testing, and more.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Name Your Project */}
          {currentStep === 2 && (
            <div className="space-y-6 max-w-xl mx-auto">
              <div className="text-center space-y-2">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-[#00D9FF]/20 to-[#BD00FF]/20 rounded-full border border-[#00D9FF]/30 mb-4">
                  <FileText className="w-8 h-8 text-[#00D9FF]" />
                </div>
                <h2 className="text-2xl font-bold">Name Your Project</h2>
                <p className="text-gray-400">Give your automation a memorable name</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-300">
                    Project Name <span className="text-red-400">*</span>
                  </label>
                  <Input
                    value={wizardState.projectName}
                    onChange={(e) => updateState({ projectName: e.target.value })}
                    placeholder="Enter project name..."
                    className="bg-[#1A1A1B] border-gray-700 text-white placeholder:text-gray-500 focus:border-[#00D9FF]"
                    autoFocus
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-300">Suggestions</label>
                  <div className="flex flex-wrap gap-2">
                    {['My First Bot', 'Civ 6 Helper', 'Test Automation'].map((suggestion) => (
                      <Button
                        key={suggestion}
                        variant="outline"
                        size="sm"
                        onClick={() => handleSuggestion(suggestion)}
                        className="border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF] text-gray-300"
                      >
                        {suggestion}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-300">
                    Description <span className="text-gray-500 text-xs">(optional)</span>
                  </label>
                  <Input
                    value={wizardState.projectDescription}
                    onChange={(e) => updateState({ projectDescription: e.target.value })}
                    placeholder="What will this automation do?"
                    className="bg-[#1A1A1B] border-gray-700 text-white placeholder:text-gray-500 focus:border-[#00D9FF]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Choose Template */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <div className="text-center space-y-2">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-[#00D9FF]/20 to-[#BD00FF]/20 rounded-full border border-[#00D9FF]/30 mb-4">
                  <Layout className="w-8 h-8 text-[#00D9FF]" />
                </div>
                <h2 className="text-2xl font-bold">Choose a Template</h2>
                <p className="text-gray-400">Start with a template or build from scratch</p>
              </div>

              <div className="grid grid-cols-3 gap-4 max-w-3xl mx-auto">
                {templates.map((template) => {
                  const Icon = template.icon;
                  const isSelected = wizardState.selectedTemplate === template.id;

                  return (
                    <button
                      key={template.id}
                      onClick={() => updateState({ selectedTemplate: template.id })}
                      className={cn(
                        "p-6 rounded-lg border-2 transition-all duration-300 text-left hover:shadow-lg",
                        isSelected
                          ? "bg-[#00D9FF]/10 border-[#00D9FF] shadow-[0_0_20px_rgba(0,217,255,0.2)]"
                          : "bg-[#1A1A1B]/50 border-gray-800 hover:border-gray-700"
                      )}
                    >
                      <div className="space-y-3">
                        <div className={cn(
                          "inline-flex items-center justify-center w-12 h-12 rounded-lg",
                          isSelected
                            ? "bg-[#00D9FF]/20 border border-[#00D9FF]/30"
                            : "bg-gray-800 border border-gray-700"
                        )}>
                          <Icon className={cn(
                            "w-6 h-6",
                            isSelected ? "text-[#00D9FF]" : "text-gray-400"
                          )} />
                        </div>
                        <div>
                          <h3 className="font-semibold mb-1">{template.name}</h3>
                          <p className="text-sm text-gray-400">{template.description}</p>
                        </div>
                        {isSelected && (
                          <div className="flex items-center gap-2 text-[#00D9FF] text-sm">
                            <CheckCircle2 className="w-4 h-4" />
                            <span>Selected</span>
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 4: What Will You Automate? */}
          {currentStep === 4 && (
            <div className="space-y-6 max-w-2xl mx-auto">
              <div className="text-center space-y-2">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-[#00D9FF]/20 to-[#BD00FF]/20 rounded-full border border-[#00D9FF]/30 mb-4">
                  <Target className="w-8 h-8 text-[#00D9FF]" />
                </div>
                <h2 className="text-2xl font-bold">What Will You Automate?</h2>
                <p className="text-gray-400">Help us customize your experience</p>
              </div>

              <div className="bg-[#1A1A1B]/30 border border-gray-800 rounded-lg p-4 mb-4">
                <p className="text-sm text-gray-400">
                  Understanding your use case helps us provide better guidance, templates, and features tailored to your needs.
                </p>
              </div>

              <RadioGroup
                value={wizardState.useCase}
                onValueChange={(value) => updateState({ useCase: value as WizardState['useCase'] })}
                className="space-y-3"
              >
                {[
                  { value: 'gaming', label: 'Gaming', description: 'Automate repetitive game tasks (recommended for beginners)', icon: Gamepad2 },
                  { value: 'productivity', label: 'Productivity/Business', description: 'Streamline business processes and workflows', icon: Briefcase },
                  { value: 'testing', label: 'Testing/QA', description: 'Automated testing and quality assurance', icon: TestTube },
                  { value: 'exploring', label: 'Just Exploring', description: 'Learning and experimenting with automation', icon: Compass },
                ].map((option) => {
                  const Icon = option.icon;
                  const isSelected = wizardState.useCase === option.value;

                  return (
                    <label
                      key={option.value}
                      className={cn(
                        "flex items-start gap-4 p-4 rounded-lg border-2 cursor-pointer transition-all duration-300",
                        isSelected
                          ? "bg-[#00D9FF]/10 border-[#00D9FF] shadow-[0_0_20px_rgba(0,217,255,0.1)]"
                          : "bg-[#1A1A1B]/50 border-gray-800 hover:border-gray-700"
                      )}
                    >
                      <RadioGroupItem value={option.value} className="mt-1" />
                      <div className="flex items-start gap-3 flex-1">
                        <div className={cn(
                          "p-2 rounded-lg",
                          isSelected ? "bg-[#00D9FF]/20" : "bg-gray-800"
                        )}>
                          <Icon className={cn(
                            "w-5 h-5",
                            isSelected ? "text-[#00D9FF]" : "text-gray-400"
                          )} />
                        </div>
                        <div className="flex-1">
                          <div className="font-semibold mb-1">{option.label}</div>
                          <div className="text-sm text-gray-400">{option.description}</div>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </RadioGroup>
            </div>
          )}

          {/* Step 5: Ready to Build! */}
          {currentStep === 5 && (
            <div className="space-y-6 text-center">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-[#00FF88]/20 to-[#00D9FF]/20 rounded-full border border-[#00FF88]/30 mb-4">
                <CheckCircle2 className="w-10 h-10 text-[#00FF88]" />
              </div>
              <div className="space-y-2">
                <h2 className="text-3xl font-bold">Ready to Build!</h2>
                <p className="text-gray-400">Your automation project is configured and ready to go</p>
              </div>

              {/* Summary */}
              <div className="bg-[#1A1A1B]/50 border border-gray-800 rounded-lg p-6 max-w-xl mx-auto text-left">
                <h3 className="font-semibold mb-4 text-center">Project Summary</h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-start">
                    <span className="text-gray-400">Name:</span>
                    <span className="font-medium text-right">{wizardState.projectName || 'My First Automation'}</span>
                  </div>
                  {wizardState.projectDescription && (
                    <div className="flex justify-between items-start">
                      <span className="text-gray-400">Description:</span>
                      <span className="font-medium text-right max-w-xs">{wizardState.projectDescription}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-start">
                    <span className="text-gray-400">Template:</span>
                    <span className="font-medium">{templates.find(t => t.id === wizardState.selectedTemplate)?.name}</span>
                  </div>
                  <div className="flex justify-between items-start">
                    <span className="text-gray-400">Use Case:</span>
                    <span className="font-medium capitalize">{wizardState.useCase}</span>
                  </div>
                </div>
              </div>

              {/* Quick Tips */}
              <div className="bg-gradient-to-r from-[#00D9FF]/10 to-[#BD00FF]/10 border border-[#00D9FF]/30 rounded-lg p-6 max-w-xl mx-auto text-left">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-[#BD00FF]" />
                  Quick Tips for Getting Started
                </h3>
                <ul className="space-y-2 text-sm text-gray-300">
                  <li className="flex items-start gap-2">
                    <span className="text-[#00D9FF] mt-1">•</span>
                    <span>Right-click on the canvas to add states to your workflow</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#00D9FF] mt-1">•</span>
                    <span>Select a state to configure actions like clicking or typing</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#00D9FF] mt-1">•</span>
                    <span>Upload screenshots for image recognition automation</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#00D9FF] mt-1">•</span>
                    <span>Save your work frequently and export when ready</span>
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="flex items-center justify-between pt-4 border-t border-gray-800">
          <div>
            {currentStep > 1 && currentStep < TOTAL_STEPS && (
              <Button
                variant="outline"
                onClick={handleBack}
                className="border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF] text-gray-300"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {currentStep < TOTAL_STEPS && (
              <Button
                variant="ghost"
                onClick={handleSkip}
                className="text-gray-400 hover:text-white"
              >
                Skip Wizard
              </Button>
            )}

            {currentStep < TOTAL_STEPS ? (
              <Button
                onClick={handleNext}
                className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black font-medium"
                disabled={currentStep === 2 && !wizardState.projectName.trim()}
              >
                {currentStep === 1 ? 'Get Started' : 'Next'}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  onClick={handleWatchTutorial}
                  className="border-[#BD00FF] text-[#BD00FF] hover:bg-[#BD00FF]/10"
                  disabled={createProject.isPending}
                >
                  Watch Tutorial First
                </Button>
                <Button
                  onClick={handleOpenProject}
                  className="bg-gradient-to-r from-[#00D9FF] to-[#00FF88] hover:opacity-90 text-black font-medium"
                  disabled={createProject.isPending}
                >
                  {createProject.isPending ? (
                    <>
                      <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin mr-2" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Rocket className="w-4 h-4 mr-2" />
                      Open Project
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
