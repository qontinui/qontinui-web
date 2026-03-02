import React from "react";
import { Circle, Star, Zap } from "lucide-react";
import type { DifficultyLevel } from "@/types/tutorial";
import { Badge } from "@/components/ui/badge";

const variants: Record<
  DifficultyLevel,
  { icon: React.ReactNode; color: string }
> = {
  beginner: {
    icon: <Circle className="h-3 w-3" />,
    color: "bg-green-500/10 text-green-700",
  },
  intermediate: {
    icon: <Star className="h-3 w-3" />,
    color: "bg-yellow-500/10 text-yellow-700",
  },
  advanced: {
    icon: <Zap className="h-3 w-3" />,
    color: "bg-red-500/10 text-red-700",
  },
};

export function DifficultyBadge({
  difficulty,
}: {
  difficulty: DifficultyLevel;
}) {
  const { icon, color } = variants[difficulty];

  return (
    <Badge variant="secondary" className={`${color} flex items-center gap-1`}>
      {icon}
      <span className="capitalize">{difficulty}</span>
    </Badge>
  );
}
