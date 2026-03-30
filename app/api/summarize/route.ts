/**
 * Note Summarization API Route
 *
 * Security: AI API key stored in server environment only
 * Privacy: Fetches content from Craft API, processes with AI, returns summary
 * No storage: Content is transient and never persisted
 */

import { streamText } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { NextRequest } from 'next/server'

const ENABLE_AI_SUMMARIZE = process.env.ENABLE_AI_SUMMARIZE === 'true'
const ALLOWED_CRAFT_HOST = 'connect.craft.do'
const ALLOWED_PATHNAME = /^\/links\/[^/]+\/api\/v1\/?$/

// Simple in-memory rate limiter (resets on deployment/restart)
const rateLimiter = new Map<string, { count: number; resetAt: number }>()

interface SummarizeRequest {
  nodeId: string
  nodeType: 'document' | 'block' | 'tag' | 'folder'
  craftUrl: string
  craftKey?: string
}

/**
 * Check rate limit for given IP address
 * Limits: 10 requests per 10 minutes per IP
 */
function checkRateLimit(ip: string): { allowed: boolean; resetIn?: number } {
  const now = Date.now()
  const limit = rateLimiter.get(ip)

  const MAX_REQUESTS = 10
  const WINDOW_MS = 10 * 60 * 1000 // 10 minutes

  if (!limit || now > limit.resetAt) {
    rateLimiter.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return { allowed: true }
  }

  if (limit.count >= MAX_REQUESTS) {
    return {
      allowed: false,
      resetIn: Math.ceil((limit.resetAt - now) / 1000)
    }
  }

  limit.count++
  return { allowed: true }
}

/**
 * Recursively extract all markdown content from Craft blocks
 */
function extractAllMarkdown(blocks: unknown): string {
  const parts: string[] = []

  function traverse(block: Record<string, unknown>) {
    if (typeof block.markdown === 'string') {
      parts.push(block.markdown)
    }
    if (Array.isArray(block.content)) {
      block.content.forEach((item) => {
        if (item && typeof item === 'object') {
          traverse(item as Record<string, unknown>)
        }
      })
    }
  }

  if (Array.isArray(blocks)) {
    blocks.forEach((block) => {
      if (block && typeof block === 'object') {
        traverse(block as Record<string, unknown>)
      }
    })
  } else if (blocks && typeof blocks === 'object') {
    traverse(blocks as Record<string, unknown>)
  }

  return parts.join('\n\n').trim()
}

/**
 * Build summarization prompt
 */
function buildPrompt(content: string): string {
  return `Analyze the following NOTE and provide a concise summary in 2-5 bullet points.
Focus on:
- Main topics and key ideas
- Important insights or decisions
- Action items or conclusions
- Start with the summary right away, no preambles.
- Keep the summary under 100 words.
- Use telegraph style.

Keep each bullet point clear and actionable. Use markdown formatting.

<NOTE>
${content}
</NOTE>

Summary:`
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

export async function POST(request: NextRequest) {
  if (!ENABLE_AI_SUMMARIZE) {
    return Response.json(
      { error: 'AI summarize endpoint is disabled on this deployment.' },
      { status: 404 }
    )
  }

  try {
    // 1. Rate limiting check
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    const rateCheck = checkRateLimit(ip)

    if (!rateCheck.allowed) {
      return Response.json(
        { error: `Rate limit exceeded. Try again in ${rateCheck.resetIn} seconds.` },
        {
          status: 429,
          headers: { 'Retry-After': String(rateCheck.resetIn) }
        }
      )
    }

    // 2. Parse and validate request
    const body = await request.json() as SummarizeRequest
    const { nodeId, nodeType, craftUrl, craftKey } = body

    console.log('Summarize request received:', {
      hasNodeId: !!nodeId,
      hasNodeType: !!nodeType,
      hasCraftUrl: !!craftUrl,
      hasCraftKey: !!craftKey,
      nodeId: nodeId || 'missing',
      nodeType: nodeType || 'missing',
    })

    if (!nodeId || !craftUrl) {
      console.error('Missing fields:', { nodeId: !!nodeId, craftUrl: !!craftUrl, craftKey: !!craftKey })
      return Response.json(
        { error: 'Missing required fields: nodeId or craftUrl' },
        { status: 400 }
      )
    }

    if (!isAllowedCraftUrl(craftUrl)) {
      return Response.json(
        { error: 'Invalid Craft API URL' },
        { status: 400 }
      )
    }

    if (nodeType !== 'document' && nodeType !== 'block') {
      return Response.json(
        { error: 'Can only summarize documents and blocks (not tags or folders)' },
        { status: 422 }
      )
    }

    // 3. Fetch content from Craft API (reuse proxy pattern)
    const blocksUrl = `${craftUrl}/blocks?id=${nodeId}&maxDepth=-1`
    const blocksResponse = await fetch(blocksUrl, {
      headers: {
        'Content-Type': 'application/json',
        ...(craftKey ? { Authorization: `Bearer ${craftKey}` } : {}),
      },
    })

    if (!blocksResponse.ok) {
      const errorText = await blocksResponse.text()
      console.error('Craft API error:', blocksResponse.status, errorText)
      return Response.json(
        {
          error: 'Failed to fetch note content from Craft API',
          details: errorText
        },
        { status: blocksResponse.status }
      )
    }

    const blocks = await blocksResponse.json()

    // 4. Extract markdown recursively
    const content = extractAllMarkdown(blocks)

    // 5. Validate content length
    if (content.length < 10) {
      return Response.json(
        { error: 'Note has insufficient content to summarize' },
        { status: 422 }
      )
    }

    if (content.length > 50000) {
      return Response.json(
        { error: 'Note is too large to summarize (max 50,000 characters)' },
        { status: 413 }
      )
    }

    // 6. Call AI for summarization via OpenRouter
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      console.error('Missing OPENROUTER_API_KEY environment variable')
      return Response.json(
        { error: 'AI service not configured. Please contact administrator.' },
        { status: 503 }
      )
    }

    // Use OpenRouter with Gemini Flash (cheap and reliable)
    const openrouter = createOpenRouter({ apiKey })
    const result = streamText({
      model: openrouter.chat('google/gemini-2.5-flash-lite'),
      prompt: buildPrompt(content),
    })

    // 7. Return streaming response
    return result.toTextStreamResponse({
      headers: {
        'Cache-Control': 'no-store', // Don't cache summaries
      }
    })

  } catch (error) {
    console.error('Summarization error:', error)
    return Response.json(
      {
        error: 'Failed to generate summary',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}
