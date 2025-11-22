import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    console.log('[AutomationStreaming Toggle API Route] POST request received')

    const authorization = request.headers.get('Authorization')
    console.log('[AutomationStreaming Toggle API Route] Authorization header present:', !!authorization)

    if (!authorization) {
      console.error('[AutomationStreaming Toggle API Route] Missing authorization header')
      return NextResponse.json(
        { error: 'Missing authorization header' },
        { status: 401 }
      )
    }

    const body = await request.json()
    console.log('[AutomationStreaming Toggle API Route] Request body:', body)

    const backendBaseUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
    const backendUrl = `${backendBaseUrl}/api/v1/users/me/automation-streaming/toggle`

    console.log('[AutomationStreaming Toggle API Route] Backend URL:', backendUrl)
    console.log('[AutomationStreaming Toggle API Route] Attempting to fetch from backend...')

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Authorization': authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    console.log('[AutomationStreaming Toggle API Route] Backend response status:', response.status)
    console.log('[AutomationStreaming Toggle API Route] Backend response ok:', response.ok)

    const data = await response.json()
    console.log('[AutomationStreaming Toggle API Route] Backend response data:', data)

    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('[AutomationStreaming Toggle API Route] ERROR:', error)
    console.error('[AutomationStreaming Toggle API Route] Error message:', (error as Error).message)
    console.error('[AutomationStreaming Toggle API Route] Error stack:', (error as Error).stack)

    return NextResponse.json(
      {
        error: 'Failed to proxy request to backend',
        details: (error as Error).message,
        name: (error as Error).name
      },
      { status: 500 }
    )
  }
}
