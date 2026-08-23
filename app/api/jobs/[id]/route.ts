import { getJob, publicJob } from '@/server/archive-manager.mjs';
import { errorResponse, jsonResponse } from '@/server/http.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return jsonResponse({ job: publicJob(await getJob(id)) });
  } catch (error) {
    return errorResponse(error);
  }
}
