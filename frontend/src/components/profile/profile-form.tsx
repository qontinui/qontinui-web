"use client"

import { useState } from "react"
import { User } from "@/types/auth-types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"
import { Save, Loader2 } from "lucide-react"

interface ProfileFormProps {
  user: User
  onUpdate: (data: { full_name?: string; email?: string; company?: string; phone?: string }) => Promise<void>
}

export function ProfileForm({ user, onUpdate }: ProfileFormProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [formData, setFormData] = useState({
    full_name: user.full_name || '',
    email: user.email || '',
    username: user.username || '',
    company: '',
    phone: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.email || !formData.full_name) {
      toast.error('Name and email are required')
      return
    }

    setIsSaving(true)
    try {
      await onUpdate({
        full_name: formData.full_name,
        email: formData.email,
        company: formData.company,
        phone: formData.phone,
      })
      toast.success('Profile updated successfully')
      setIsEditing(false)
    } catch (error: any) {
      toast.error(error.message || 'Failed to update profile')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setFormData({
      full_name: user.full_name || '',
      email: user.email || '',
      username: user.username || '',
      company: '',
      phone: '',
    })
    setIsEditing(false)
  }

  return (
    <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl">Profile Information</CardTitle>
            <CardDescription>Manage your personal information</CardDescription>
          </div>
          {!isEditing && (
            <Button
              onClick={() => setIsEditing(true)}
              className="bg-[#00D9FF]/10 hover:bg-[#00D9FF]/20 text-[#00D9FF] border border-[#00D9FF]/30"
            >
              Edit Profile
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="full_name" className="text-gray-300">Full Name *</Label>
              <Input
                id="full_name"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                disabled={!isEditing}
                className="bg-[#0A0A0B] border-gray-700 text-white disabled:opacity-70"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="username" className="text-gray-300">Username</Label>
              <Input
                id="username"
                value={formData.username}
                disabled
                className="bg-[#0A0A0B] border-gray-700 text-gray-500 cursor-not-allowed"
                title="Username cannot be changed"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="text-gray-300">Email *</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                disabled={!isEditing}
                className="bg-[#0A0A0B] border-gray-700 text-white disabled:opacity-70"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="company" className="text-gray-300">Company</Label>
              <Input
                id="company"
                value={formData.company}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                disabled={!isEditing}
                className="bg-[#0A0A0B] border-gray-700 text-white disabled:opacity-70"
                placeholder="Your company name"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="phone" className="text-gray-300">Phone Number</Label>
              <Input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                disabled={!isEditing}
                className="bg-[#0A0A0B] border-gray-700 text-white disabled:opacity-70"
                placeholder="+1 (555) 123-4567"
              />
            </div>
          </div>

          {isEditing && (
            <div className="flex items-center gap-3 pt-4">
              <Button
                type="submit"
                disabled={isSaving}
                className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black font-medium"
              >
                {isSaving ? (
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
                disabled={isSaving}
                variant="outline"
                className="border-gray-700 hover:border-gray-600 bg-transparent"
              >
                Cancel
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
