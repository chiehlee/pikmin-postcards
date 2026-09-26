import { editFriendProfile, softDeleteFriend } from '@/server/archive-manager.mjs';
import { assertSameOrigin, errorResponse, jsonResponse } from '@/server/http.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, context: { params: Promise<{ name: string }> }) {
  try {
    assertSameOrigin(request);
    const { name } = await context.params;
    const body = await request.json().catch(() => ({})) as {
      name?: unknown;
      likely_base_area?: unknown;
    };
    return jsonResponse({
      friend: await editFriendProfile(name, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.likely_base_area !== undefined ? { likely_base_area: body.likely_base_area } : {}),
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ name: string }> }) {
  try {
    assertSameOrigin(request);
    const { name } = await context.params;
    const body = await request.json().catch(() => ({})) as { reason?: string };
    return jsonResponse({
      friend: await softDeleteFriend(name, body.reason || '使用者由網站移除寄件者情報'),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
