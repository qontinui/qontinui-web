"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RAGDashboardHeader } from "@/components/rag-dashboard/RAGDashboardHeader";
import { RAGEmbeddingsList } from "@/components/rag-dashboard/RAGEmbeddingsList";
import { RAGJobsList } from "@/components/rag-dashboard/RAGJobsList";
import { RAGSearchPanel } from "@/components/rag-dashboard/RAGSearchPanel";
import { ArrowLeft, Database, History, Search, Loader2 } from "lucide-react";
import { useRAGDashboard } from "@/hooks/useRAGDashboard";

export default function RAGDashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const projectId = params.projectId as string;

  const [activeTab, setActiveTab] = useState("elements");

  const { data: dashboard, isLoading, error } = useRAGDashboard(projectId);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-brand-primary mx-auto mb-2" />
          <div className="text-lg text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      {/* Header */}
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => router.push("/dashboard")}
              className="text-text-muted hover:text-white"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Dashboard
            </Button>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-brand-primary to-brand-secondary bg-clip-text text-transparent">
              Visual Index
            </h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6 max-w-7xl mx-auto">
        {/* Dashboard Stats Header */}
        <RAGDashboardHeader
          stats={dashboard}
          isLoading={isLoading}
          error={error}
        />

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-8">
          <TabsList className="bg-surface-canvas/50 border border-border-subtle">
            <TabsTrigger
              value="elements"
              className="data-[state=active]:bg-brand-primary/20 data-[state=active]:text-brand-primary"
            >
              <Database className="w-4 h-4 mr-2" />
              Indexed Elements
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="data-[state=active]:bg-brand-primary/20 data-[state=active]:text-brand-primary"
            >
              <History className="w-4 h-4 mr-2" />
              Processing History
            </TabsTrigger>
            <TabsTrigger
              value="search"
              className="data-[state=active]:bg-brand-primary/20 data-[state=active]:text-brand-primary"
            >
              <Search className="w-4 h-4 mr-2" />
              Semantic Search
            </TabsTrigger>
          </TabsList>

          <TabsContent value="elements" className="mt-6">
            <RAGEmbeddingsList projectId={projectId} />
          </TabsContent>

          <TabsContent value="history" className="mt-6">
            <RAGJobsList projectId={projectId} />
          </TabsContent>

          <TabsContent value="search" className="mt-6">
            <RAGSearchPanel projectId={projectId} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
