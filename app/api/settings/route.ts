import { assertSameOrigin, errorResponse, jsonResponse } from '@/server/http.mjs';
import {
  isLoopbackRequest,
  removeApiKey,
  saveSettings,
  settingsStatus,
} from '@/server/settings-store.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    return jsonResponse({
      settings: await settingsStatus({ secretWriteAllowed: isLoopbackRequest(request) }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await request.json() as { api_key?: string; model?: string };
    return jsonResponse(await saveSettings({ apiKey: body.api_key, model: body.model }, {
      secretWriteAllowed: isLoopbackRequest(request),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    return jsonResponse(await removeApiKey({ secretWriteAllowed: isLoopbackRequest(request) }));
  } catch (error) {
    return errorResponse(error);
  }
}
