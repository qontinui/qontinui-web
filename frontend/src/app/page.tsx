"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ArrowRight, Zap, Brain, Target, X, Check, LogIn } from "lucide-react"
import { AuthDialog } from "@/components/auth-dialog"
import { AuthProvider, useAuth } from "@/contexts/auth-context"
import { toast } from "sonner"

function LandingContent() {
  const [authDialogOpen, setAuthDialogOpen] = useState(false)
  const [signupMode, setSignupMode] = useState(true) // Start in signup mode
  const { user } = useAuth()
  const router = useRouter()

  // Remove auto-redirect - let users stay on landing page even if logged in
  // They can click their dashboard link in the header if they want

  const handleGetStarted = () => {
    setSignupMode(true)
    setAuthDialogOpen(true)
  }


  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header with Sign In button or Dashboard link */}
      <header className="fixed top-0 w-full z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h2 className="text-2xl font-bold text-primary">Qontinui</h2>
          {user ? (
            <div className="flex items-center space-x-4">
              <span className="text-sm text-muted-foreground">{user.email}</span>
              <Button
                variant="outline"
                onClick={() => router.push('/dashboard')}
                className="border-primary/50 hover:border-primary hover:bg-primary/10"
              >
                Go to Dashboard
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={() => setAuthDialogOpen(true)}
              className="border-primary/50 hover:border-primary hover:bg-primary/10"
            >
              <LogIn className="mr-2 h-4 w-4" />
              Sign In
            </Button>
          )}
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
        <div className="absolute inset-0 dot-grid animate-pulse" />
        <div className="container mx-auto px-4 text-center relative z-10">
          <Badge className="mb-6 bg-accent/20 text-accent border-accent/30 glow-green">Free to Get Started</Badge>

          <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold mb-6 text-balance">
            GUI Automation That <span className="text-primary">Thinks Like You Do</span>
          </h1>

          <p className="text-xl md:text-2xl text-muted-foreground mb-8 max-w-3xl mx-auto text-pretty">
            Introducing model-based GUI automation - a system that adapts to unexpected changes instead of breaking
          </p>

          <Button
            size="lg"
            onClick={handleGetStarted}
            className="bg-primary text-primary-foreground hover:bg-primary/90 glow-cyan pulse-cyan text-lg px-8 py-4"
          >
            Get Started Free
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </section>

      {/* Key Benefits Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-16">Why Qontinui Changes Everything</h2>

          <div className="grid md:grid-cols-3 gap-8">
            <Card className="p-8 bg-card border-border hover:border-primary/50 transition-all duration-300 group hover:glow-cyan">
              <div className="mb-6">
                <div className="w-12 h-12 bg-primary/20 rounded-lg flex items-center justify-center group-hover:glow-cyan transition-all duration-300">
                  <Brain className="h-6 w-6 text-primary" />
                </div>
              </div>
              <h3 className="text-xl font-semibold mb-4">Robust Against Changes</h3>
              <p className="text-muted-foreground">
                Unlike traditional scripting that breaks when UI changes, Qontinui adapts in real-time - just like a
                human would
              </p>
            </Card>

            <Card className="p-8 bg-card border-border hover:border-secondary/50 transition-all duration-300 group hover:glow-purple">
              <div className="mb-6">
                <div className="w-12 h-12 bg-secondary/20 rounded-lg flex items-center justify-center group-hover:glow-purple transition-all duration-300">
                  <Target className="h-6 w-6 text-secondary" />
                </div>
              </div>
              <h3 className="text-xl font-semibold mb-4">Handles Complex Tasks</h3>
              <p className="text-muted-foreground">
                Navigate complex workflows with multiple paths and unexpected scenarios - from simple clicks to entire
                business processes
              </p>
            </Card>

            <Card className="p-8 bg-card border-border hover:border-accent/50 transition-all duration-300 group hover:glow-green">
              <div className="mb-6">
                <div className="w-12 h-12 bg-accent/20 rounded-lg flex items-center justify-center group-hover:glow-green transition-all duration-300">
                  <Zap className="h-6 w-6 text-accent" />
                </div>
              </div>
              <h3 className="text-xl font-semibold mb-4">Continuous, Not Discrete</h3>
              <p className="text-muted-foreground">
                Works like you do - continuously adapting to the current state rather than following rigid scripts that
                fail at the first obstacle
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* Comparison Section */}
      <section className="py-20 px-4 bg-muted/20">
        <div className="container mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-16">Beyond Traditional Automation</h2>

          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            <Card className="p-8 bg-card/50 border-destructive/30 opacity-75">
              <h3 className="text-xl font-semibold mb-6 text-destructive flex items-center">
                <X className="h-5 w-5 mr-2" />
                Traditional Automation
              </h3>
              <ul className="space-y-3 text-muted-foreground">
                <li>• Fixed scripts that break easily</li>
                <li>• Exponential complexity with UI changes</li>
                <li>• Requires constant maintenance</li>
                <li>• Fails at unexpected scenarios</li>
                <li>• Brittle and unreliable</li>
              </ul>
            </Card>

            <Card className="p-8 bg-card border-primary/30 glow-cyan">
              <h3 className="text-xl font-semibold mb-6 text-primary flex items-center">
                <Check className="h-5 w-5 mr-2" />
                Qontinui Automation
              </h3>
              <ul className="space-y-3">
                <li>• Adaptive pathfinding technology</li>
                <li>• Self-healing automation flows</li>
                <li>• Scales with your application</li>
                <li>• Handles unexpected changes gracefully</li>
                <li>• Robust and reliable by design</li>
              </ul>
            </Card>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-16">How It Works</h2>

          <div className="max-w-4xl mx-auto">
            <div className="flex flex-col md:flex-row items-center justify-between space-y-8 md:space-y-0 md:space-x-8">
              <div className="flex-1">
                <Card className="p-6 bg-card border-border text-center">
                  <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-2xl font-bold text-primary">1</span>
                  </div>
                  <h3 className="font-semibold mb-2">Observe State</h3>
                  <p className="text-sm text-muted-foreground">Continuously monitors the current UI state</p>
                </Card>
              </div>

              <ArrowRight className="h-8 w-8 text-secondary rotate-90 md:rotate-0" />

              <div className="flex-1">
                <Card className="p-6 bg-card border-border text-center">
                  <div className="w-16 h-16 bg-secondary/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-2xl font-bold text-secondary">2</span>
                  </div>
                  <h3 className="font-semibold mb-2">Adapt Path</h3>
                  <p className="text-sm text-muted-foreground">Dynamically adjusts approach based on changes</p>
                </Card>
              </div>

              <ArrowRight className="h-8 w-8 text-secondary rotate-90 md:rotate-0" />

              <div className="flex-1">
                <Card className="p-6 bg-card border-border text-center">
                  <div className="w-16 h-16 bg-accent/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-2xl font-bold text-accent">3</span>
                  </div>
                  <h3 className="font-semibold mb-2">Execute Action</h3>
                  <p className="text-sm text-muted-foreground">Performs the optimal action for current state</p>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 bg-muted/20">
        <div className="container mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to Transform Your Automation?</h2>
          <p className="text-muted-foreground mb-8">
            Start building intelligent, adaptive GUI automation in minutes
          </p>
          <Button
            size="lg"
            onClick={handleGetStarted}
            className="bg-primary text-primary-foreground hover:bg-primary/90 glow-cyan pulse-cyan text-lg px-8 py-4"
          >
            Get Started Free
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </section>

      {/* Auth Dialog */}
      <AuthDialog
        open={authDialogOpen}
        onOpenChange={setAuthDialogOpen}
        defaultTab={signupMode ? "signup" : "signin"}
      />
    </div>
  )
}

export default function QontinuiLanding() {
  return (
    <AuthProvider>
      <LandingContent />
    </AuthProvider>
  )
}
