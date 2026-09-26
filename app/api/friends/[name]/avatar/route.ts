import { recropFriendAvatar } from '@/server/archive-manager.mjs';
import { assertSameOrigin, errorResponse, jsonResponse } from '@/server/http.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ name: string }> }) {
  try {
    assertSameOrigin(request);
    const { name } = await context.params;
    return jsonResponse(await recropFriendAvatar(name));
  } catch (error) {
    return errorResponse(error);
  }
}
