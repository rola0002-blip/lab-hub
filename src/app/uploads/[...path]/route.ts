import { readUpload } from '@/lib/uploads'

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const file = await readUpload(path)
  if (!file) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(file.data), { headers: { 'Content-Type': file.mime, 'Cache-Control': 'public, max-age=86400' } })
}
