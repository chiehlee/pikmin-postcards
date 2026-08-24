import { assertSameOrigin, errorResponse, jsonResponse } from '@/server/http.mjs';
import { isLoopbackRequest, testSettingsConnection } from '@/server/settings-store.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await request.json().catch(() => ({})) as { api_key?: string; model?: string; provider?: 'openai_api' | 'local_codex'; reasoning_effort?: string };
    return jsonResponse(await testSettingsConnection({
      apiKey: body.api_key,
      model: body.model,
      provider: body.provider,
      reasoningEffort: body.reasoning_effort,
    }, {
      secretWriteAllowed: isLoopbackRequest(request),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
