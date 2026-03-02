import React from "react";
import { BookOpen, Clock } from "lucide-react";
import type { Tutorial } from "@/types/tutorial";
import type { TutorialStatus } from "../_types/tutorial-menu";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { DifficultyBadge } from "./DifficultyBadge";
import { StatusBadge } from "./StatusBadge";

interface TutorialCardProps {
  tutorial: Tutorial;
  status: TutorialStatus;
  isNew: boolean;
  onClick: (tutorial: Tutorial) => void;
}

export function TutorialCard({
  tutorial,
  status,
  isNew,
  onClick,
}: TutorialCardProps) {
  return (
    <Card
      className="cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={() => onClick(tutorial)}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <CardTitle className="text-lg flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              {tutorial.title}
              {isNew && (
                <Badge
                  variant="secondary"
                  className="bg-blue-500/10 text-blue-700"
                >
                  New
                </Badge>
              )}
            </CardTitle>
            {tutorial.description && (
              <CardDescription className="mt-2">
                {tutorial.description}
              </CardDescription>
            )}
          </div>
          <StatusBadge status={status} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <DifficultyBadge difficulty={tutorial.difficulty} />

          {tutorial.duration && (
            <Badge variant="outline" className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {tutorial.duration}
            </Badge>
          )}

          {tutorial.category && (
            <Badge variant="outline" className="capitalize">
              {tutorial.category}
            </Badge>
          )}

          <Badge variant="outline">
            {tutorial.steps.length}{" "}
            {tutorial.steps.length === 1 ? "step" : "steps"}
          </Badge>
        </div>

        {tutorial.learningObjectives &&
          tutorial.learningObjectives.length > 0 && (
            <div className="mt-3 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                You&apos;ll learn:
              </p>
              <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5">
                {tutorial.learningObjectives
                  .slice(0, 2)
                  .map((objective, idx) => (
                    <li key={idx}>{objective}</li>
                  ))}
                {tutorial.learningObjectives.length > 2 && (
                  <li className="text-muted-foreground/70">
                    +{tutorial.learningObjectives.length - 2} more...
                  </li>
                )}
              </ul>
            </div>
          )}
      </CardContent>
    </Card>
  );
}
