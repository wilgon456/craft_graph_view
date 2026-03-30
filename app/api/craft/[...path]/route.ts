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
const WRITE_ALLOWED_ENDPOINTS = new Set([
  'documents',
  'blocks',
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

function getCredentials(request: NextRequest): { craftUrl: string; craftKey?: string } | null {
  const craftUrl = request.headers.get('x-craft-url')
  const craftKey = request.headers.get('x-craft-key') || undefined
  if (!craftUrl) return null
  if (!isAllowedCraftUrl(craftUrl)) return null
  return { craftUrl, craftKey }
}

function buildCraftHeaders(craftKey?: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    ...(craftKey ? { Authorization: `Bearer ${craftKey}` } : {}),
  }
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
      { error: 'Missing or invalid Craft API URL' },
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
      headers: buildCraftHeaders(craftKey),
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

export async function PUT(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handleWrite('PUT', request, ctx)
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handleWrite('POST', request, ctx)
}

export async function DELETE() {
  return Response.json(
    { error: 'Method not allowed. Proxy is read-only.' },
    { status: 405 }
  )
}

async function handleWrite(
  method: 'POST' | 'PUT',
  request?: NextRequest,
  ctx?: { params: Promise<{ path: string[] }> }
) {
  if (!request || !ctx) {
    return Response.json(
      { error: `Method ${method} requires request context` },
      { status: 400 }
    )
  }

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
      { error: 'Missing or invalid Craft API URL' },
      { status: 401 }
    )
  }

  const resolvedParams = await ctx.params
  const endpoint = resolvedParams.path[0]
  if (!endpoint || !WRITE_ALLOWED_ENDPOINTS.has(endpoint)) {
    return Response.json(
      { error: `Endpoint not allowed for ${method} by proxy policy` },
      { status: 403 }
    )
  }

  const { craftUrl, craftKey } = credentials
  const url = buildTargetUrl(request, craftUrl, resolvedParams.path)

  try {
    const body = await request.text()
    const response = await fetch(url, {
      method,
      headers: buildCraftHeaders(craftKey),
      body,
    })

    const responseText = await response.text()
    if (!response.ok) {
      console.error(`Craft API ${method} error:`, response.status, responseText)
      return Response.json(
        { error: `Craft API ${method} error: ${response.statusText}`, details: responseText },
        { status: response.status }
      )
    }

    return new Response(responseText, {
      status: response.status,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': response.headers.get('content-type') || 'application/json',
      },
    })
  } catch (error) {
    console.error(`Craft API ${method} proxy error:`, error)
    return Response.json(
      { error: `Failed to ${method} to Craft API`, details: String(error) },
      { status: 500 }
    )
  }
}
