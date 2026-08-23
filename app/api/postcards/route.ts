import { publicJob, startAddJob } from '@/server/archive-manager.mjs';
import { assertSameOrigin, errorResponse, jsonResponse } from '@/server/http.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const form = await request.formData();
    const image = form.get('image');
    const file = image instanceof File && image.size > 0 ? image : null;
    const sourceUrl = String(form.get('source_url') ?? '').trim() || null;
    const note = String(form.get('note') ?? '').trim();
    const job = await startAddJob({ file, sourceUrl, note });
    return jsonResponse({ job: publicJob(job) }, job.status === 'completed' ? 200 : 202);
  } catch (error) {
    return errorResponse(error);
  }
}
