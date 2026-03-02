import React from "react";
import { Settings, Trash2, Wand2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ApplicationProfile } from "@/services/template-capture-service";

interface ProfileCardProps {
  profile: ApplicationProfile;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onTune: () => void;
}

export function ProfileCard({
  profile,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
  onTune,
}: ProfileCardProps) {
  return (
    <Card
      className={cn(
        "cursor-pointer transition-colors",
        isSelected && "ring-2 ring-primary"
      )}
      onClick={onSelect}
    >
      <CardHeader className="py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base">{profile.name}</CardTitle>
            <Badge variant="outline">
              {Math.round(profile.success_rate * 100)}% success
            </Badge>
            <Badge variant="secondary">{profile.sample_count} samples</Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onTune();
              }}
            >
              <Wand2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            >
              <Settings className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-red-600 hover:text-red-700"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </CardHeader>
      {profile.preferred_strategies &&
        profile.preferred_strategies.length > 0 && (
          <CardContent className="py-2 pt-0">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Strategies:</span>
              {profile.preferred_strategies.map((s) => (
                <Badge key={s} variant="outline" className="text-xs">
                  {s}
                </Badge>
              ))}
            </div>
          </CardContent>
        )}
    </Card>
  );
}
