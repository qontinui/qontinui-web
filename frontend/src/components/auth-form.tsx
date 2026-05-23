"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  loginFormSchema,
  registerFormSchema,
  type LoginFormData,
  type RegisterFormData,
} from "@/lib/schemas";
import type { User } from "@/types/auth-types";

export interface AuthFormProps {
  /** Initial tab to render. Both tabs are always available; this just selects the default. */
  mode?: "signin" | "signup";
  /**
   * Called after a successful sign-in or sign-up with the resulting user.
   * Use to close a dialog, redirect, or show a follow-up step.
   */
  onSuccess?: (user: User) => void;
  /** Hide the tab strip so only one form (matching `mode`) is shown. */
  hideTabs?: boolean;
  /** Where the "Forgot your password?" link points. Defaults to /forgot-password. */
  forgotPasswordHref?: string;
  /** Called when the forgot-password link is clicked (e.g. close a containing dialog). */
  onForgotPasswordClick?: () => void;
}

/**
 * Reusable sign-in / sign-up form. Shared by the marketing-header AuthDialog
 * and the standalone `/login` route.
 *
 * Authentication is handled via `useAuth()`. After a successful login or
 * registration the form invokes `onSuccess(user)` so the caller can decide
 * whether to close a modal, redirect, or both.
 */
export function AuthForm({
  mode = "signin",
  onSuccess,
  hideTabs = false,
  forgotPasswordHref = "/forgot-password",
  onForgotPasswordClick,
}: AuthFormProps) {
  const { login, register: registerUser } = useAuth();
  const [loading, setLoading] = useState(false);

  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: {
      username: "",
      password: "",
      remember_me: false,
    },
  });

  const registerForm = useForm<RegisterFormData>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: {
      email: "",
      username: "",
      password: "",
      confirmPassword: "",
      full_name: "",
    },
  });

  const handleLogin = async (data: LoginFormData) => {
    setLoading(true);
    try {
      const user = await login(data.username, data.password, data.remember_me);
      toast.success("Logged in successfully");
      loginForm.reset();
      if (user) {
        onSuccess?.(user);
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (data: RegisterFormData) => {
    setLoading(true);
    try {
      await registerUser(
        data.email,
        data.username,
        data.password,
        data.full_name
      );
      toast.success("Account created successfully");
      registerForm.reset();
      // The auth context auto-logs the user in after registration; the
      // refreshed user lands in context via state. We re-pull from a
      // subsequent render via onSuccess — pass a minimal stub here so the
      // caller can react. Most callers just need "we're done".
      onSuccess?.({
        id: "",
        email: data.email,
        username: data.username,
        is_active: true,
        is_superuser: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Registration failed"
      );
    } finally {
      setLoading(false);
    }
  };

  const signinPanel = (
    <form
      onSubmit={loginForm.handleSubmit(handleLogin)}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label htmlFor="login-username">Email or username</Label>
        <Input
          id="login-username"
          type="text"
          placeholder="you@example.com or your_username"
          {...loginForm.register("username")}
          disabled={loading}
        />
        {loginForm.formState.errors.username && (
          <p className="text-sm text-red-500">
            {loginForm.formState.errors.username.message}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="login-password">Password</Label>
        <Input
          id="login-password"
          type="password"
          {...loginForm.register("password")}
          disabled={loading}
        />
        {loginForm.formState.errors.password && (
          <p className="text-sm text-red-500">
            {loginForm.formState.errors.password.message}
          </p>
        )}
      </div>
      <div className="flex items-center space-x-2">
        <Checkbox
          id="remember-me"
          checked={loginForm.watch("remember_me")}
          onCheckedChange={(checked) => {
            loginForm.setValue("remember_me", checked as boolean);
          }}
          disabled={loading}
        />
        <Label
          htmlFor="remember-me"
          className="text-sm font-normal cursor-pointer"
        >
          Remember me for 90 days
        </Label>
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Signing in..." : "Sign In"}
      </Button>
      <div className="text-center mt-4">
        <Link
          href={forgotPasswordHref}
          className="text-sm text-muted-foreground hover:text-primary"
          onClick={onForgotPasswordClick}
        >
          Forgot your password?
        </Link>
      </div>
    </form>
  );

  const signupPanel = (
    <form
      onSubmit={registerForm.handleSubmit(handleRegister)}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label htmlFor="register-email">Email</Label>
        <Input
          id="register-email"
          type="email"
          placeholder="you@example.com"
          {...registerForm.register("email")}
          disabled={loading}
        />
        {registerForm.formState.errors.email && (
          <p className="text-sm text-red-500">
            {registerForm.formState.errors.email.message}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="register-username">Username</Label>
        <Input
          id="register-username"
          type="text"
          placeholder="your_username"
          {...registerForm.register("username")}
          disabled={loading}
        />
        {registerForm.formState.errors.username && (
          <p className="text-sm text-red-500">
            {registerForm.formState.errors.username.message}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="register-fullname">Full Name (optional)</Label>
        <Input
          id="register-fullname"
          type="text"
          placeholder="John Doe"
          {...registerForm.register("full_name")}
          disabled={loading}
        />
        {registerForm.formState.errors.full_name && (
          <p className="text-sm text-red-500">
            {registerForm.formState.errors.full_name.message}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="register-password">Password</Label>
        <Input
          id="register-password"
          type="password"
          {...registerForm.register("password")}
          disabled={loading}
        />
        {registerForm.formState.errors.password && (
          <p className="text-sm text-red-500">
            {registerForm.formState.errors.password.message}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="register-confirm-password">Confirm Password</Label>
        <Input
          id="register-confirm-password"
          type="password"
          {...registerForm.register("confirmPassword")}
          disabled={loading}
        />
        {registerForm.formState.errors.confirmPassword && (
          <p className="text-sm text-red-500">
            {registerForm.formState.errors.confirmPassword.message}
          </p>
        )}
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Creating account..." : "Create Account"}
      </Button>
    </form>
  );

  if (hideTabs) {
    return mode === "signup" ? signupPanel : signinPanel;
  }

  return (
    <Tabs
      defaultValue={mode === "signup" ? "register" : "login"}
      className="w-full"
    >
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="login">Login</TabsTrigger>
        <TabsTrigger value="register">Register</TabsTrigger>
      </TabsList>
      <TabsContent value="login">{signinPanel}</TabsContent>
      <TabsContent value="register">{signupPanel}</TabsContent>
    </Tabs>
  );
}
