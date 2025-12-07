"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Globe, ArrowLeft, Eye, Lock } from "lucide-react";

interface PublicProject {
  id: string;
  name: string;
  description: string | null;
  configuration: any;
  updated_at: string;
  created_at: string;
  owner_id: string;
}

export default function DemoProjectPage() {
  const params = useParams();
  const projectId = params.id as string;

  const [project, setProject] = useState<PublicProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPublicProject = async () => {
      try {
        const apiUrl =
          process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const response = await fetch(
          `${apiUrl}/api/v1/public/projects/${projectId}`
        );

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error("Project not found or is not public");
          }
          throw new Error("Failed to fetch project");
        }

        const data = await response.json();
        setProject(data);
      } catch (err: any) {
        setError(err.message || "An error occurred");
      } finally {
        setLoading(false);
      }
    };

    fetchPublicProject();
  }, [projectId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
        <p className="text-zinc-600 dark:text-zinc-400">Loading project...</p>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-4">
              Project Not Found
            </h1>
            <p className="text-zinc-600 dark:text-zinc-400 mb-8">
              {error || "This project does not exist or is not public."}
            </p>
            <Link href="/demo">
              <Button>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Demo Projects
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const workflows = project.configuration?.workflows || [];
  const actions = project.configuration?.actions || [];

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Demo Mode Banner */}
      <div className="bg-blue-600 dark:bg-blue-700 text-white py-3">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Eye className="w-5 h-5" />
            <div>
              <p className="font-semibold">Demo Mode - Read Only</p>
              <p className="text-sm text-blue-100">
                You're viewing a public project. Sign up to create your own!
              </p>
            </div>
          </div>
          <Link href="/auth/register">
            <Button
              size="sm"
              className="bg-white text-blue-600 hover:bg-zinc-100"
            >
              Create Account
            </Button>
          </Link>
        </div>
      </div>

      {/* Header */}
      <div className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Link
            href="/demo"
            className="inline-flex items-center text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Demo Projects
          </Link>

          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
                  {project.name}
                </h1>
                <Badge variant="outline" className="flex items-center gap-1">
                  <Globe className="w-3 h-3" />
                  Public
                </Badge>
              </div>
              <p className="text-zinc-600 dark:text-zinc-400 max-w-2xl">
                {project.description || "No description provided"}
              </p>
              <div className="flex gap-4 mt-4 text-sm text-zinc-500">
                <span>
                  Created: {new Date(project.created_at).toLocaleDateString()}
                </span>
                <span>
                  Updated: {new Date(project.updated_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Workflows</CardTitle>
                <CardDescription>
                  {workflows.length} workflow{workflows.length !== 1 ? "s" : ""}{" "}
                  in this project
                </CardDescription>
              </CardHeader>
              <CardContent>
                {workflows.length === 0 ? (
                  <p className="text-sm text-zinc-500">
                    No workflows defined yet
                  </p>
                ) : (
                  <div className="space-y-3">
                    {workflows.map((workflow: any, index: number) => (
                      <div
                        key={index}
                        className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <h4 className="font-medium text-zinc-900 dark:text-zinc-100">
                              {workflow.name || `Workflow ${index + 1}`}
                            </h4>
                            {workflow.description && (
                              <p className="text-sm text-zinc-500 mt-1">
                                {workflow.description}
                              </p>
                            )}
                          </div>
                          <Badge variant="secondary" className="text-xs">
                            {workflow.actions?.length || 0} actions
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Actions</CardTitle>
                <CardDescription>
                  {actions.length} action{actions.length !== 1 ? "s" : ""}{" "}
                  defined
                </CardDescription>
              </CardHeader>
              <CardContent>
                {actions.length === 0 ? (
                  <p className="text-sm text-zinc-500">
                    No actions defined yet
                  </p>
                ) : (
                  <div className="space-y-2">
                    {actions.slice(0, 10).map((action: any, index: number) => (
                      <div
                        key={index}
                        className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-900 rounded-md"
                      >
                        <div className="flex-1">
                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            {action.name || `Action ${index + 1}`}
                          </p>
                          <p className="text-xs text-zinc-500">
                            Type: {action.type || "Unknown"}
                          </p>
                        </div>
                      </div>
                    ))}
                    {actions.length > 10 && (
                      <p className="text-sm text-zinc-500 text-center pt-2">
                        and {actions.length - 10} more actions...
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <Card className="bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-950 dark:to-cyan-950 border-blue-200 dark:border-blue-800">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lock className="w-5 h-5" />
                  Read-Only Mode
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">
                  This is a public demo project. You can view the configuration,
                  but you cannot:
                </p>
                <ul className="text-sm text-zinc-600 dark:text-zinc-400 space-y-2 list-disc list-inside">
                  <li>Edit workflows or actions</li>
                  <li>Run automations</li>
                  <li>Save changes</li>
                  <li>Delete the project</li>
                </ul>
                <div className="pt-4 space-y-2">
                  <Link href="/auth/register" className="block">
                    <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                      Create Your Own Project
                    </Button>
                  </Link>
                  <Link href="/auth/login" className="block">
                    <Button variant="outline" className="w-full">
                      Sign In
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Project Stats</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    Workflows
                  </span>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {workflows.length}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    Actions
                  </span>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {actions.length}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
