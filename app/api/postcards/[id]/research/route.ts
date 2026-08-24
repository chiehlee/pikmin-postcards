import { publicJob, startReresearchJob } from '@/server/archive-manager.mjs';
import { assertSameOrigin, errorResponse, jsonResponse } from '@/server/http.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as { user_note?: unknown };
    if (body.user_note != null && typeof body.user_note !== 'string') {
      return jsonResponse({ error: '使用者補充必須是文字' }, 400);
    }
    return jsonResponse({
      job: publicJob(await startReresearchJob(id, { userNote: body.user_note })),
    }, 202);
  } catch (error) {
    return errorResponse(error);
  }
}
