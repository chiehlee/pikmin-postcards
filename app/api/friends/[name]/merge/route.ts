import { mergeFriendProfiles } from '@/server/archive-manager.mjs';
import { assertSameOrigin, errorResponse, jsonResponse } from '@/server/http.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ name: string }> }) {
  try {
    assertSameOrigin(request);
    const { name } = await context.params;
    const body = await request.json().catch(() => ({})) as { target_name?: unknown };
    if (typeof body.target_name !== 'string') return jsonResponse({ error: '請選擇要合併到的寄件者。' }, 400);
    return jsonResponse(await mergeFriendProfiles(name, body.target_name));
  } catch (error) {
    return errorResponse(error);
  }
}
