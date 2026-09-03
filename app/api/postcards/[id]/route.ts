import { setPostcardReadState, softDeletePostcard } from '@/server/archive-manager.mjs';
import { assertSameOrigin, errorResponse, jsonResponse } from '@/server/http.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as { is_read?: unknown };
    if (typeof body.is_read !== 'boolean') return jsonResponse({ error: 'is_read 必須是布林值' }, 400);
    const postcard = await setPostcardReadState(id, body.is_read);
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
