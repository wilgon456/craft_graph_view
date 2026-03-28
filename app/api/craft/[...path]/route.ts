/**
 * Craft API Proxy
 *
 * Proxies requests to Craft API to avoid CORS issues.
 * Credentials are passed via headers and never stored on server.
 */

import { NextRequest } from 'next/server'

const ALLOWED_CRAFT_HOST = 'connect.craft.do'
const ALLOWED_PATHNAME = /^\/links\/[^/]+\/api\/v1\/?$/
const ALLOWED_ENDPOINTS = new Set([
  'documents',
  'blocks',
  'collections',
  'document-search',
  'documents-search',
])

const proxyRateLimiter = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(ip: string): { allowed: boolean; resetIn?: number } {
  const now = Date.now()
  const current = proxyRateLimiter.get(ip)
  const WINDOW_MS = 60 * 1000
  const MAX_REQUESTS = 60

  if (!current || now > current.resetAt) {
    proxyRateLimiter.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return { allowed: true }
  }

  if (current.count >= MAX_REQUESTS) {
    return { allowed: false, resetIn: Math.ceil((current.resetAt - now) / 1000) }
  }

  current.count += 1
  return { allowed: true }
}

function isAllowedCraftUrl(craftUrl: string): boolean {
  try {
    const parsed = new URL(craftUrl)
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === ALLOWED_CRAFT_HOST &&
      ALLOWED_PATHNAME.test(parsed.pathname)
    )
  } catch {
    return false
  }
}

function getCredentials(request: NextRequest): { craftUrl: string; craftKey: string } | null {
  const craftUrl = request.headers.get('x-craft-url')
  const craftKey = request.headers.get('x-craft-key')
  if (!craftUrl || !craftKey) return null
  if (!isAllowedCraftUrl(craftUrl)) return null
  return { craftUrl, craftKey }
}

function buildTargetUrl(request: NextRequest, craftUrl: string, path: string[]): string {
  const searchParams = request.nextUrl.searchParams.toString()
  return `${craftUrl}/${path.join('/')}${searchParams ? `?${searchParams}` : ''}`
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  const rateCheck = checkRateLimit(ip)
  if (!rateCheck.allowed) {
    return Response.json(
      { error: `Rate limit exceeded. Try again in ${rateCheck.resetIn} seconds.` },
      { status: 429, headers: { 'Retry-After': String(rateCheck.resetIn) } }
    )
  }

  const credentials = getCredentials(request)
  if (!credentials) {
    return Response.json(
      { error: 'Missing or invalid Craft API credentials' },
      { status: 401 }
    )
  }

  const { craftUrl, craftKey } = credentials
  const resolvedParams = await params
  const endpoint = resolvedParams.path[0]
  if (!endpoint || !ALLOWED_ENDPOINTS.has(endpoint)) {
    return Response.json(
      { error: 'Endpoint not allowed by proxy policy' },
      { status: 403 }
    )
  }
  const url = buildTargetUrl(request, craftUrl, resolvedParams.path)

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${craftKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Craft API error:', response.status, errorText)
      return Response.json(
        { error: `Craft API error: ${response.statusText}`, details: errorText },
        { status: response.status }
      )
    }

    const data = await response.json()
    return Response.json(data, {
      status: response.status,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error('Craft API proxy error:', error)
    return Response.json(
      { error: 'Failed to fetch from Craft API', details: String(error) },
      { status: 500 }
    )
  }
}

export async function PUT() {
  return Response.json(
    { error: 'Method not allowed. Proxy is read-only.' },
    { status: 405 }
  )
}

export async function POST() {
  return Response.json(
    { error: 'Method not allowed. Proxy is read-only.' },
    { status: 405 }
  )
}

export async function DELETE() {
  return Response.json(
    { error: 'Method not allowed. Proxy is read-only.' },
    { status: 405 }
  )
}
