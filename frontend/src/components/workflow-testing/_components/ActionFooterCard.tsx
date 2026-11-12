"use client";

import { Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardFooter } from "@/components/ui/card";

interface ActionFooterCardProps {
  onSave: () => void;
  onCancel: () => void;
}

export function ActionFooterCard({ onSave, onCancel }: ActionFooterCardProps) {
  return (
    <Card>
      <CardFooter className="flex justify-between">
        <Button onClick={onCancel} variant="outline">
          <X />
          Cancel
        </Button>
        <Button onClick={onSave}>
          <Save />
          Save
        </Button>
      </CardFooter>
    </Card>
  );
}
