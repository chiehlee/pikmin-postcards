import { publicJob, startReresearchJob } from '@/server/archive-manager.mjs';
import { assertSameOrigin, errorResponse, jsonResponse } from '@/server/http.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    return jsonResponse({ job: publicJob(await startReresearchJob(id)) }, 202);
  } catch (error) {
    return errorResponse(error);
  }
}
