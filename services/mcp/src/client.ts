export const REQUEST_TIMEOUT_MS = 15_000
const MAX_OUTPUT_CHARS = 50_000

export class LabHubApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'LabHubApiError'
  }
}

export class LabHubNetworkError extends Error {
  constructor(cause: unknown) {
    super(describeCause(cause))
    this.name = 'LabHubNetworkError'
  }
}

export function labhubUrl(): string {
  return (process.env.LABHUB_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
}

function describeCause(e: unknown): string {
  const target = labhubUrl()
  if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
    return `LabHub request to ${target} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
  }
  return `Could not reach LabHub at ${target}: ${e instanceof Error ? e.message : String(e)}`
}

export async function request(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(`${labhubUrl()}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${process.env.LABHUB_API_KEY ?? ''}`,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (e) {
    throw new LabHubNetworkError(e)
  }
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const err = (data ?? {}) as Record<string, unknown>
    const code = typeof err.error === 'string' ? err.error : 'unknown_error'
    const detail = typeof err.message === 'string' ? `: ${err.message}` : ''
    throw new LabHubApiError(res.status, code, `LabHub ${res.status} ${code}${detail}`)
  }
  return data
}

export const get = (path: string): Promise<unknown> => request(path)

export function qs(params: Record<string, string | undefined>): string {
  const defined = Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined)
  return defined.length ? `?${new URLSearchParams(defined).toString()}` : ''
}

export function toText(data: unknown): string {
  const json = JSON.stringify(data)
  return json.length > MAX_OUTPUT_CHARS ? `${json.slice(0, MAX_OUTPUT_CHARS)}…[truncated at 50KB]` : json
}
