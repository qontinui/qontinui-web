import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
  try {
    console.log('[AutomationStreaming API Route] GET request received')

    // Get the access token from cookie (preferred) or Authorization header (fallback)
    const cookieStore = await cookies()
    const accessTokenCookie = cookieStore.get('access_token')
    const authorizationHeader = request.headers.get('Authorization')

    // Use cookie token or extract from Authorization header
    let accessToken: string | null = null
    if (accessTokenCookie?.value) {
      accessToken = accessTokenCookie.value
      console.log('[AutomationStreaming API Route] Using token from cookie')
    } else if (authorizationHeader?.startsWith('Bearer ')) {
      accessToken = authorizationHeader.substring(7)
      console.log('[AutomationStreaming API Route] Using token from Authorization header')
    }

    if (!accessToken) {
      console.error('[AutomationStreaming API Route] No access token found in cookie or header')
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    // Use environment variable or fall back to localhost
    const backendBaseUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
    const backendUrl = `${backendBaseUrl}/api/v1/users/me/automation-streaming`

    console.log('[AutomationStreaming API Route] Backend URL:', backendUrl)
    console.log('[AutomationStreaming API Route] Attempting to fetch from backend...')

    const response = await fetch(backendUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    console.log('[AutomationStreaming API Route] Backend response status:', response.status)
    console.log('[AutomationStreaming API Route] Backend response ok:', response.ok)

    const data = await response.json()
    console.log('[AutomationStreaming API Route] Backend response data:', data)

    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('[AutomationStreaming API Route] ERROR:', error)
    console.error('[AutomationStreaming API Route] Error name:', (error as Error).name)
    console.error('[AutomationStreaming API Route] Error message:', (error as Error).message)
    console.error('[AutomationStreaming API Route] Error stack:', (error as Error).stack)

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

export async function POST(request: NextRequest) {
  try {
    // Get the access token from cookie (preferred) or Authorization header (fallback)
    const cookieStore = await cookies()
    const accessTokenCookie = cookieStore.get('access_token')
    const authorizationHeader = request.headers.get('Authorization')

    // Use cookie token or extract from Authorization header
    let accessToken: string | null = null
    if (accessTokenCookie?.value) {
      accessToken = accessTokenCookie.value
    } else if (authorizationHeader?.startsWith('Bearer ')) {
      accessToken = authorizationHeader.substring(7)
    }

    if (!accessToken) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    // Get the request body
    const body = await request.json()

    // Determine which backend endpoint to call based on the URL
    const backendBaseUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
    let backendUrl = `${backendBaseUrl}/api/v1/users/me/automation-streaming`

    // Check if this is a toggle or reset-limit request
    if (request.url.includes('/toggle')) {
      backendUrl += '/toggle'
    } else if (request.url.includes('/reset-limit')) {
      backendUrl += '/reset-limit'
    }

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const data = await response.json()

    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Error proxying to backend:', error)
    return NextResponse.json(
      { error: 'Failed to proxy request to backend' },
      { status: 500 }
    )
  }
}
