import { softDeletePostcard } from '@/server/archive-manager.mjs';
import { assertSameOrigin, errorResponse, jsonResponse } from '@/server/http.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
