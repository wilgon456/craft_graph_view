import { NextRequest } from 'next/server'

const ALLOWED_CRAFT_HOST = 'connect.craft.do'
const ALLOWED_PATHNAME = /^\/links\/[^/]+\/api\/v1\/?$/

interface ResearchRequest {
  topic?: string
  craftUrl?: string
  craftKey?: string
}

interface CraftDocumentItem {
  id: string
  title?: string
  clickableLink?: string
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

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function craftFetch(
  craftUrl: string,
  craftKey: string,
  endpoint: string,
  init?: RequestInit
) {
  const response = await fetch(`${craftUrl}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${craftKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Craft API failed (${response.status}): ${details.slice(0, 300)}`)
  }

  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function generateResearch(topic: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY on server.')
  }

  const today = new Date().toISOString().slice(0, 10)
  const prompt = [
    '당신은 시니어 리서치 애널리스트다.',
    `주제: ${topic}`,
    '',
    '요구사항:',
    '- 한국어로 작성',
    '- 최신성 중요한 정보는 확인 날짜를 YYYY-MM-DD로 표기',
    '- 주장마다 출처 URL을 포함',
    '- 과장 없이 검증 가능한 사실 중심',
    '',
    '출력 형식(마크다운):',
    '## Findings',
    '### Q1. ...',
    '- ... (근거: URL, 확인일: YYYY-MM-DD)',
    '### Q2. ...',
    '- ...',
    '### Q3. ...',
    '- ...',
    '## Quick Summary',
    '- 핵심 5줄',
    '',
    `기준 날짜: ${today}`,
  ].join('\n')

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-5-mini',
      input: prompt,
      tools: [{ type: 'web_search_preview' }],
    }),
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`OpenAI Responses failed (${response.status}): ${details.slice(0, 400)}`)
  }

  const data = await response.json()
  const text = typeof data.output_text === 'string' ? data.output_text.trim() : ''
  if (!text) {
    throw new Error('OpenAI response did not include output_text.')
  }

  return text
}

function extractRootBlockId(blockResponse: unknown): string | null {
  if (!blockResponse) return null
  if (Array.isArray(blockResponse)) {
    return blockResponse.find((item) => item && typeof item.id === 'string')?.id ?? null
  }
  if (
    typeof blockResponse === 'object' &&
    blockResponse !== null &&
    Array.isArray((blockResponse as { blocks?: unknown }).blocks)
  ) {
    const blocks = (blockResponse as { blocks: Array<{ id?: string }> }).blocks
    return blocks.find((item: { id?: string }) => {
      if (!item || typeof item !== 'object') return false
      return typeof (item as { id?: unknown }).id === 'string'
    })?.id ?? null
  }
  if (
    typeof blockResponse === 'object' &&
    blockResponse !== null &&
    typeof (blockResponse as { id?: unknown }).id === 'string'
  ) {
    return (blockResponse as { id: string }).id
  }
  return null
}

async function findDocumentByTitle(
  craftUrl: string,
  craftKey: string,
  title: string
): Promise<CraftDocumentItem | null> {
  const regexps = escapeRegex(title)
  const encoded = encodeURIComponent(regexps)
  const result = await craftFetch(craftUrl, craftKey, `/documents/search?regexps=${encoded}`)
  const items = Array.isArray(result?.items) ? result.items : []
  const exact = items.find((item: CraftDocumentItem) => item?.title === title)
  if (!exact) return null
  return {
    id: exact.id,
    title: exact.title,
    clickableLink: exact.clickableLink,
  }
}

async function createDocument(
  craftUrl: string,
  craftKey: string,
  title: string,
  markdown: string
): Promise<CraftDocumentItem | null> {
  const payloads = [
    { title, markdown },
    { title, content: [{ type: 'text', markdown }] },
    { document: { title, markdown } },
  ]

  for (const payload of payloads) {
    try {
      const response = await craftFetch(craftUrl, craftKey, '/documents', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      const id = response?.id || response?.item?.id || response?.document?.id
      if (typeof id === 'string' && id) {
        return {
          id,
          title: response?.title || response?.document?.title || title,
          clickableLink: response?.clickableLink || response?.document?.clickableLink,
        }
      }
    } catch {
      // Try next shape.
    }
  }

  return null
}

async function upsertResearchDocument(
  craftUrl: string,
  craftKey: string,
  title: string,
  markdown: string
) {
  let target = await findDocumentByTitle(craftUrl, craftKey, title)
  let created = false

  if (!target) {
    target = await createDocument(craftUrl, craftKey, title, markdown)
    created = !!target
  }

  if (!target?.id) {
    throw new Error('Could not find or create target Craft document.')
  }

  const blockTree = await craftFetch(craftUrl, craftKey, `/blocks?id=${target.id}&maxDepth=1`)
  const rootBlockId = extractRootBlockId(blockTree)

  if (!rootBlockId) {
    throw new Error('Failed to resolve root block id for target document.')
  }

  await craftFetch(craftUrl, craftKey, '/blocks', {
    method: 'PUT',
    body: JSON.stringify({ blocks: [{ id: rootBlockId, markdown }] }),
  })

  return { ...target, created }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ResearchRequest
    const topic = body.topic?.trim()
    const craftUrl = body.craftUrl?.trim()
    const craftKey = body.craftKey?.trim()

    if (!topic) {
      return Response.json({ error: 'topic is required' }, { status: 400 })
    }
    if (!craftUrl || !craftKey) {
      return Response.json({ error: 'craftUrl and craftKey are required' }, { status: 400 })
    }
    if (!isAllowedCraftUrl(craftUrl)) {
      return Response.json({ error: 'Invalid Craft API URL' }, { status: 400 })
    }

    const markdown = await generateResearch(topic)
    const title = `[Research Brief] ${topic}`

    const saved = await upsertResearchDocument(craftUrl, craftKey, title, markdown)

    return Response.json({
      ok: true,
      topic,
      title,
      content: markdown,
      craft: {
        documentId: saved.id,
        created: saved.created,
        clickableLink: saved.clickableLink ?? null,
      },
    })
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
