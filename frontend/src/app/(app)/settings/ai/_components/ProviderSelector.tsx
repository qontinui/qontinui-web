import { Bot, Terminal, Sparkles, Zap } from "lucide-react";
import { PROVIDER_OPTIONS, type AiProvider } from "../types";

const ICONS = {
  Terminal: <Terminal className="size-5" />,
  Bot: <Bot className="size-5" />,
  Sparkles: <Sparkles className="size-5" />,
  Zap: <Zap className="size-5" />,
};

interface ProviderSelectorProps {
  provider: AiProvider;
  onProviderChange: (provider: AiProvider) => void;
}

export function ProviderSelector({
  provider,
  onProviderChange,
}: ProviderSelectorProps) {
  return (
    <div className="rounded-lg border border-border">
      <div className="px-4 py-3 border-b border-border bg-muted/50">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Bot className="size-4" />
          Provider Selection
        </h3>
        <p className="text-xs text-muted-foreground">
          Choose which AI provider to use for automation tasks
        </p>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-2 gap-3">
          {PROVIDER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onProviderChange(opt.value)}
              className={`relative flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                provider === opt.value
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border hover:border-border/80 hover:bg-accent/50"
              }`}
            >
              <div
                className={`mt-0.5 ${provider === opt.value ? "text-primary" : "text-muted-foreground"}`}
              >
                {ICONS[opt.iconName]}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {opt.label}
                  {opt.recommended && (
                    <span
                      data-content-role="badge"
                      data-content-label="recommended provider"
                      className="ml-1.5 text-xs text-primary font-normal"
                    >
                      Recommended
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {opt.description}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
