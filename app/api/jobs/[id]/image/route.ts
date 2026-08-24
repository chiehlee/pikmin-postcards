import { createHash } from 'node:crypto';
import { getJobImage } from '@/server/archive-manager.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const image = await getJobImage(id);
    const mediaType = String(image.mediaType);
    const etag = `"${createHash('sha256').update(image.bytes).digest('hex')}"`;
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: imageHeaders(mediaType, etag, image.bytes.length) });
    }
    return new Response(image.bytes, { headers: imageHeaders(mediaType, etag, image.bytes.length) });
  } catch (error) {
    const status = Number.isInteger((error as { status?: number })?.status)
      ? (error as { status: number }).status
      : 500;
    return Response.json({ error: error instanceof Error ? error.message : '讀取工作圖片失敗' }, {
      status,
      headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
  }
}

function imageHeaders(mediaType: string, etag: string, bytes: number) {
  return {
    'cache-control': 'private, max-age=0, must-revalidate',
    'content-length': String(bytes),
    'content-type': mediaType,
    etag,
    'x-content-type-options': 'nosniff',
  };
}
