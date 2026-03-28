"use client"

import * as React from "react"
import ReactMarkdown from "react-markdown"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"

const STORAGE_KEY_URL = "craft_api_url"
const STORAGE_KEY_KEY = "craft_api_key"

interface ResearchResponse {
  ok: boolean
  topic?: string
  title?: string
  content?: string
  craft?: {
    documentId?: string
    created?: boolean
    clickableLink?: string | null
  }
  error?: string
}

export default function ResearchPage() {
  const [topic, setTopic] = React.useState("")
  const [isRunning, setIsRunning] = React.useState(false)
  const [hasConnection, setHasConnection] = React.useState(false)
  const [result, setResult] = React.useState<ResearchResponse | null>(null)

  React.useEffect(() => {
    const apiUrl = localStorage.getItem(STORAGE_KEY_URL)
    const apiKey = localStorage.getItem(STORAGE_KEY_KEY)
    setHasConnection(Boolean(apiUrl && apiKey))
  }, [])

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!topic.trim()) return

    const craftUrl = localStorage.getItem(STORAGE_KEY_URL) || ""
    const craftKey = localStorage.getItem(STORAGE_KEY_KEY) || ""
    if (!craftUrl || !craftKey) {
      setResult({
        ok: false,
        error: "Craft 연결 정보가 없습니다. 왼쪽 상단 그래프 화면에서 먼저 Save connection 해주세요.",
      })
      return
    }

    setIsRunning(true)
    setResult(null)

    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topic: topic.trim(),
          craftUrl,
          craftKey,
        }),
      })

      const data = (await response.json()) as ResearchResponse
      setResult(data)
    } catch (error) {
      setResult({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-10 pt-[calc(var(--header-offset)+12px)] sm:px-6">
      <Card className="p-5 sm:p-6">
        <h1 className="text-lg font-semibold">Topic-Only Research Agent</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          주제만 넣으면 GPT가 웹 리서치하고 Craft 문서 <code>[Research Brief] 주제</code>를 자동 생성/갱신합니다.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          연결 상태: {hasConnection ? "Craft 연결됨" : "Craft 연결 필요"}
        </p>

        <form className="mt-5 space-y-3" onSubmit={onSubmit}>
          <Field>
            <FieldLabel htmlFor="research-topic">주제</FieldLabel>
            <Input
              id="research-topic"
              placeholder="예: 미국 금리 인하가 한국 주식시장에 미치는 영향"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              disabled={isRunning}
              required
            />
          </Field>
          <Button type="submit" disabled={isRunning || !topic.trim()}>
            {isRunning ? "리서치 실행 중..." : "실행"}
          </Button>
        </form>
      </Card>

      {result && (
        <Card className="mt-4 p-5 sm:p-6">
          {result.ok ? (
            <div className="space-y-4">
              <div className="text-sm">
                <div className="font-medium">{result.title}</div>
                <div className="text-muted-foreground">
                  Craft 문서 ID: <code>{result.craft?.documentId}</code>
                  {result.craft?.created ? " (신규 생성)" : " (기존 문서 갱신)"}
                </div>
                {result.craft?.clickableLink && (
                  <a
                    className="text-primary underline underline-offset-2"
                    href={result.craft.clickableLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Craft에서 열기
                  </a>
                )}
              </div>
              <article className="prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown>{result.content || ""}</ReactMarkdown>
              </article>
            </div>
          ) : (
            <p className="text-sm text-destructive">{result.error || "요청 처리 중 오류가 발생했습니다."}</p>
          )}
        </Card>
      )}
    </main>
  )
}
