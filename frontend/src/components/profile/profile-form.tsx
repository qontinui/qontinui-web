"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { User } from "@/types/auth-types";
import {
  updateProfileFormSchema,
  type UpdateProfileFormData,
} from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { Save, Loader2 } from "lucide-react";

interface ProfileFormProps {
  user: User;
  onUpdate: (data: {
    full_name?: string;
    email?: string;
    company?: string;
    phone?: string;
  }) => Promise<void>;
}

export function ProfileForm({ user, onUpdate }: ProfileFormProps) {
  const [isEditing, setIsEditing] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<UpdateProfileFormData>({
    resolver: zodResolver(updateProfileFormSchema),
    defaultValues: {
      email: user.email || "",
      username: user.username || "",
      full_name: user.full_name || "",
      company: user.company || "",
      phone: user.phone || "",
    },
  });

  // Reset form when user data changes
  useEffect(() => {
    reset({
      email: user.email || "",
      username: user.username || "",
      full_name: user.full_name || "",
      company: user.company || "",
      phone: user.phone || "",
    });
  }, [user, reset]);

  const onSubmit = async (data: UpdateProfileFormData) => {
    try {
      await onUpdate({
        full_name: data.full_name,
        email: data.email,
        company: data.company,
        phone: data.phone,
      });
      toast.success("Profile updated successfully");
      setIsEditing(false);
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update profile"
      );
    }
  };

  const handleCancel = () => {
    reset();
    setIsEditing(false);
  };

  return (
    <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl">Profile Information</CardTitle>
            <CardDescription>Manage your personal information</CardDescription>
          </div>
          {!isEditing && (
            <Button
              onClick={() => setIsEditing(true)}
              className="bg-brand-primary/10 hover:bg-brand-primary/20 text-brand-primary border border-brand-primary/30"
              data-ui-id="profile-edit-btn"
            >
              Edit Profile
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="full_name" className="text-text-secondary">
                Full Name *
              </Label>
              <Input
                id="full_name"
                {...register("full_name")}
                disabled={!isEditing}
                className="bg-surface-canvas border-border-default text-white disabled:opacity-70"
                data-ui-id="profile-full-name-input"
              />
              {errors.full_name && (
                <p className="text-sm text-red-500">
                  {errors.full_name.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="username" className="text-text-secondary">
                Username
              </Label>
              <Input
                id="username"
                {...register("username")}
                disabled
                className="bg-surface-canvas border-border-default text-text-muted cursor-not-allowed"
                title="Username cannot be changed"
                data-ui-id="profile-username-input"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="text-text-secondary">
                Email *
              </Label>
              <Input
                id="email"
                type="email"
                {...register("email")}
                disabled={!isEditing}
                className="bg-surface-canvas border-border-default text-white disabled:opacity-70"
                data-ui-id="profile-email-input"
              />
              {errors.email && (
                <p className="text-sm text-red-500">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="company" className="text-text-secondary">
                Company
              </Label>
              <Input
                id="company"
                {...register("company")}
                disabled={!isEditing}
                className="bg-surface-canvas border-border-default text-white disabled:opacity-70"
                placeholder="Your company name"
                data-ui-id="profile-company-input"
              />
              {errors.company && (
                <p className="text-sm text-red-500">{errors.company.message}</p>
              )}
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="phone" className="text-text-secondary">
                Phone Number
              </Label>
              <Input
                id="phone"
                type="tel"
                {...register("phone")}
                disabled={!isEditing}
                className="bg-surface-canvas border-border-default text-white disabled:opacity-70"
                placeholder="+1 (555) 123-4567"
                data-ui-id="profile-phone-input"
              />
              {errors.phone && (
                <p className="text-sm text-red-500">{errors.phone.message}</p>
              )}
            </div>
          </div>

          {isEditing && (
            <div className="flex items-center gap-3 pt-4">
              <Button
                type="submit"
                disabled={isSubmitting}
                className="bg-brand-primary hover:bg-brand-primary/80 text-black font-medium"
                data-ui-id="profile-save-btn"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save Changes
                  </>
                )}
              </Button>
              <Button
                type="button"
                onClick={handleCancel}
                disabled={isSubmitting}
                variant="outline"
                className="border-border-default hover:border-border-default bg-transparent"
                data-ui-id="profile-cancel-btn"
              >
                Cancel
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
