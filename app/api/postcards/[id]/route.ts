import { softDeletePostcard, updatePostcard } from '@/server/archive-manager.mjs';
import { assertSameOrigin, errorResponse, jsonResponse } from '@/server/http.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as { is_read?: unknown; poi_name?: unknown };
    if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonResponse({ error: '請提供有效的更新內容' }, 400);
    const unknownFields = Object.keys(body).filter((field) => !['is_read', 'poi_name'].includes(field));
    if (unknownFields.length) return jsonResponse({ error: `不支援的明信片欄位：${unknownFields.join(', ')}` }, 400);
    const postcard = await updatePostcard(id, body);
    return jsonResponse({ postcard });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as { reason?: string };
    const postcard = await softDeletePostcard(id, body.reason || '使用者由網站移除');
    return jsonResponse({ postcard });
  } catch (error) {
    return errorResponse(error);
  }
}
