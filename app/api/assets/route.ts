import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { publicPathToLocalPath, resolveStoredLocalPath } from '@/db/asset-paths.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const mediaTypes: Record<string, string> = {
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export async function GET(request: Request) {
  const publicPath = new URL(request.url).searchParams.get('path');
  if (!publicPath) return assetError(400, '缺少圖片路徑');

  const mediaType = mediaTypes[path.extname(publicPath).toLowerCase()];
  if (!mediaType) return assetError(415, '不支援的圖片格式');

  try {
    const localPath = resolveStoredLocalPath(publicPathToLocalPath(publicPath));
    const bytes = await readFile(localPath);
    const etag = `"${createHash('sha256').update(bytes).digest('hex')}"`;
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: assetHeaders(mediaType, etag, bytes.length) });
    }
    return new Response(bytes, { headers: assetHeaders(mediaType, etag, bytes.length) });
  } catch (error) {
    const status = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 400;
    return assetError(status, status === 404 ? '找不到圖片' : '圖片路徑無效');
  }
}

function assetHeaders(mediaType: string, etag: string, bytes: number) {
  return {
    'cache-control': 'public, max-age=0, must-revalidate',
    'content-length': String(bytes),
    'content-type': mediaType,
    etag,
    'x-content-type-options': 'nosniff',
  };
}

function assetError(status: number, message: string) {
  return Response.json({ error: message }, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}
