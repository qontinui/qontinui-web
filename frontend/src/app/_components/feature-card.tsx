"use client";

import React from "react";
import { Card } from "@/components/ui/card";

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  color: "primary" | "secondary" | "accent";
}

export function FeatureCard({
  icon,
  title,
  description,
  color,
}: FeatureCardProps) {
  const glowClass =
    color === "primary"
      ? "hover:glow-cyan"
      : color === "secondary"
        ? "hover:glow-purple"
        : "hover:glow-green";
  const borderClass =
    color === "primary"
      ? "hover:border-primary/50"
      : color === "secondary"
        ? "hover:border-secondary/50"
        : "hover:border-accent/50";
  const bgClass =
    color === "primary"
      ? "bg-primary/20"
      : color === "secondary"
        ? "bg-secondary/20"
        : "bg-accent/20";

  return (
    <Card
      className={`p-8 bg-card border-border ${borderClass} transition-all duration-300 group ${glowClass}`}
    >
      <div className="mb-6">
        <div
          className={`w-12 h-12 ${bgClass} rounded-lg flex items-center justify-center transition-all duration-300`}
        >
          {icon}
        </div>
      </div>
      <h3 className="text-xl font-semibold mb-4">{title}</h3>
      <p className="text-muted-foreground">{description}</p>
    </Card>
  );
}
