"use client"

import { useAutomation } from "@/contexts/automation-context"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

export const dynamic = 'force-dynamic'

export default function TestPersistence() {
  const { images, addImages, processes, states, transitions } = useAutomation()

  const addTestImage = () => {
    const testImage = {
      id: `test-${Date.now()}`,
      name: `test-image-${Date.now()}.png`,
      url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      size: 100,
      uploadedAt: new Date(),
      usageCount: 0,
      usedIn: []
    }
    addImages([testImage])
  }

  const checkLocalStorage = () => {
    const stored = localStorage.getItem('qontinui-images')
    console.log('Stored images:', stored)
    alert(`localStorage has ${stored ? JSON.parse(stored).length : 0} images`)
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Test Persistence</h1>

      <Card className="p-4 mb-4">
        <h2 className="text-lg font-semibold mb-2">Current State</h2>
        <p>Images: {images.length}</p>
        <p>Processes: {processes.length}</p>
        <p>States: {states.length}</p>
        <p>Transitions: {transitions.length}</p>
      </Card>

      <div className="space-x-2">
        <Button onClick={addTestImage}>Add Test Image</Button>
        <Button onClick={checkLocalStorage}>Check localStorage</Button>
        <Button onClick={() => window.location.reload()}>Refresh Page</Button>
      </div>

      <div className="mt-4">
        <h3 className="font-semibold mb-2">Images:</h3>
        {images.map(img => (
          <div key={img.id} className="text-sm">
            {img.name} - {img.id}
          </div>
        ))}
      </div>
    </div>
  )
}
