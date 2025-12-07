/**
 * Example Project Creation Form with Zod + React Hook Form
 *
 * Demonstrates:
 * - Complex form validation
 * - Integration with TanStack Query mutations
 * - Form reset after successful submission
 * - Error handling and display
 */

"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createProjectFormSchema,
  type CreateProjectFormData,
} from "@/lib/schemas";
import { useCreateProject } from "@/hooks/use-projects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface CreateProjectFormProps {
  onSuccess?: (projectId: string) => void;
  onCancel?: () => void;
}

export function CreateProjectForm({
  onSuccess,
  onCancel,
}: CreateProjectFormProps) {
  const createProject = useCreateProject();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateProjectFormData>({
    resolver: zodResolver(createProjectFormSchema),
    mode: "onBlur",
    defaultValues: {
      name: "",
      description: "",
    },
  });

  const onSubmit = async (data: CreateProjectFormData) => {
    try {
      const project = await createProject.mutateAsync({
        name: data.name,
        description: data.description || undefined,
        configuration: {}, // Empty configuration for new projects
      });

      toast.success(`Project "${project.name}" created successfully!`);
      reset(); // Reset form after successful creation
      onSuccess?.(project.id);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to create project";
      toast.error(errorMessage);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Project Name */}
      <div className="space-y-2">
        <Label htmlFor="name">
          Project Name <span className="text-red-500">*</span>
        </Label>
        <Input
          id="name"
          type="text"
          placeholder="My Automation Project"
          {...register("name")}
          className={errors.name ? "border-red-500" : ""}
          disabled={isSubmitting}
        />
        {errors.name && (
          <p className="text-sm text-red-500">{errors.name.message}</p>
        )}
      </div>

      {/* Project Description */}
      <div className="space-y-2">
        <Label htmlFor="description">
          Description{" "}
          <span className="text-sm text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id="description"
          placeholder="Describe what this automation does..."
          rows={4}
          {...register("description")}
          className={errors.description ? "border-red-500" : ""}
          disabled={isSubmitting}
        />
        {errors.description && (
          <p className="text-sm text-red-500">{errors.description.message}</p>
        )}
        <p className="text-xs text-muted-foreground">Maximum 1000 characters</p>
      </div>

      {/* Form Actions */}
      <div className="flex gap-3 justify-end">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          disabled={isSubmitting || createProject.isPending}
        >
          {isSubmitting || createProject.isPending
            ? "Creating..."
            : "Create Project"}
        </Button>
      </div>
    </form>
  );
}
