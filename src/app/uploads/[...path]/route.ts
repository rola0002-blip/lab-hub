import { readUpload } from '@/lib/uploads'

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const file = await readUpload(path)
  if (!file) return new Response('Not found', { status: 404 })
  const headers: Record<string, string> = { 'Content-Type': file.mime, 'Cache-Control': 'public, max-age=86400' }
  if (!file.mime.startsWith('image/')) {
    const name = path[path.length - 1] ?? 'download'
    headers['Content-Disposition'] = `attachment; filename="${name.replace(/[^a-zA-Z0-9._-]/g, '')}"`
  }
  return new Response(new Uint8Array(file.data), { headers })
}
