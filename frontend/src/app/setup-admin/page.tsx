"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function SetupAdmin() {
  const [email, setEmail] = useState("jspinak@hotmail.com")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState("")

  const handleSetupAdmin = async () => {
    setLoading(true)
    setResult("")

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
      const response = await fetch(`${apiUrl}/api/v1/users/me/claim-admin`, {
        method: 'POST',
        credentials: 'include',
      })

      const data = await response.json()

      if (response.ok) {
        setResult(`✅ Success! ${data.message}`)
      } else {
        setResult(`❌ Error: ${data.detail || data.message || 'Failed'}`)
      }
    } catch (error) {
      setResult(`❌ Error: ${error instanceof Error ? error.message : 'Failed to connect'}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Claim Admin Access</CardTitle>
          <CardDescription>
            Log in first, then click the button to make yourself admin. Only works if no admin exists yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={handleSetupAdmin}
            disabled={loading}
            className="w-full"
          >
            {loading ? 'Claiming admin...' : 'Claim Admin'}
          </Button>

          {result && (
            <div className={`p-4 rounded-lg ${result.startsWith('✅') ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
              {result}
            </div>
          )}

          {result.startsWith('✅') && (
            <div className="text-center">
              <a href="/admin" className="text-primary hover:underline">
                Go to Admin Dashboard →
              </a>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
