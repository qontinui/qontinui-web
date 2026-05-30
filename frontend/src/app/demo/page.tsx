"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Globe, Eye, Calendar } from "lucide-react";

interface PublicProject {
  id: string;
  name: string;
  description: string | null;
  updated_at: string;
  owner_id: string;
}

export default function DemoPage() {
  const {
    data: projects = [],
    isLoading: loading,
    error: queryError,
  } = useQuery<PublicProject[]>({
    queryKey: ["publicProjects"],
    queryFn: async ({ signal }) => {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
      const response = await fetch(`${apiUrl}/api/v1/public/projects`, {
        signal,
      });

      if (!response.ok) {
        throw new Error("Failed to fetch public projects");
      }

      return response.json();
    },
  });

  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : "An error occurred"
    : null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900">
      {/* Hero Section */}
      <div className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="text-center">
            <div className="flex justify-center mb-4">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-full">
                <Globe className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                  Public Demo Projects
                </span>
              </div>
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-5xl md:text-6xl mb-4">
              Explore Qontinui Automations
            </h1>
            <p className="max-w-2xl mx-auto text-xl text-zinc-600 dark:text-zinc-400">
              Browse and view public automation projects created by the Qontinui
              community. See real-world examples of workflow automation in
              action.
            </p>
            <div className="mt-8 flex justify-center gap-4">
              <Link href="/login">
                <Button
                  size="lg"
                  className="bg-[#00D9FF] hover:bg-[#00B8D9] text-black font-semibold"
                >
                  Create Your Own Project
                </Button>
              </Link>
              <Link href="/auth/login">
                <Button size="lg" variant="outline">
                  Sign In
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Projects Grid */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {loading ? (
          <div className="text-center py-12">
            <p className="text-zinc-600 dark:text-zinc-400">
              Loading public projects...
            </p>
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-red-600 dark:text-red-400">{error}</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-zinc-100 dark:bg-zinc-800 mb-4">
              <Globe className="w-8 h-8 text-zinc-400" />
            </div>
            <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 mb-2">
              No Public Projects Yet
            </h3>
            <p className="text-zinc-600 dark:text-zinc-400">
              Be the first to share a public automation project!
            </p>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                Public Projects ({projects.length})
              </h2>
              <p className="text-zinc-600 dark:text-zinc-400 mt-1">
                Click on any project to view it in read-only mode
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {projects.map((project) => (
                <Card
                  key={project.id}
                  className="hover:shadow-lg transition-shadow duration-200"
                >
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Globe className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      {project.name}
                    </CardTitle>
                    <CardDescription>
                      {project.description || "No description provided"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 text-sm text-zinc-500">
                      <Calendar className="w-4 h-4" />
                      <span>
                        Updated:{" "}
                        {new Date(project.updated_at).toLocaleDateString()}
                      </span>
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Link href={`/demo/${project.id}`} className="w-full">
                      <Button variant="outline" className="w-full">
                        <Eye className="w-4 h-4 mr-2" />
                        View Project
                      </Button>
                    </Link>
                  </CardFooter>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Footer CTA */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="bg-gradient-to-r from-blue-600 to-cyan-600 dark:from-blue-700 dark:to-cyan-700 rounded-2xl p-12 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Ready to Build Your Own Automation?
          </h2>
          <p className="text-blue-50 text-lg mb-8 max-w-2xl mx-auto">
            Join Qontinui and create powerful automation workflows with our
            visual builder. No coding required.
          </p>
          <Link href="/login">
            <Button
              size="lg"
              className="bg-white text-blue-600 hover:bg-zinc-100 font-semibold"
            >
              Get Started Free
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
