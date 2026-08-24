import { publicJob, startAddBatch } from '@/server/archive-manager.mjs';
import { assertSameOrigin, errorResponse, jsonResponse } from '@/server/http.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const form = await request.formData();
    const files = [...form.getAll('images'), form.get('image')]
      .filter((value): value is File => value instanceof File && value.size > 0);
    const sourceUrls = [
      ...String(form.get('source_urls') ?? '').split(/\r?\n/),
      String(form.get('source_url') ?? ''),
    ].map((value) => value.trim()).filter(Boolean);
    const note = String(form.get('note') ?? '').trim();
    const workflow = String(form.get('workflow') ?? 'metadata_only');
    const batch = await startAddBatch({
      inputs: [
        ...files.map((file) => ({ file, label: file.name })),
        ...sourceUrls.map((sourceUrl) => ({ sourceUrl })),
      ],
      note,
      workflow: workflow as 'metadata_only' | 'full_research',
    });
    const jobs = batch.jobs.map(publicJob).filter(Boolean) as Array<NonNullable<ReturnType<typeof publicJob>>>;
    return jsonResponse({
      batch_id: batch.batchId,
      workflow: batch.workflow,
      total: batch.total,
      jobs,
      job: jobs[0],
      failures: batch.failures.map(({ input_label, error }) => ({ input_label, error })),
    }, jobs.every((job) => job.status === 'completed') ? 200 : 202);
  } catch (error) {
    return errorResponse(error);
  }
}
