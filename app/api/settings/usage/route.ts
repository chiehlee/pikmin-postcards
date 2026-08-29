import { errorResponse, jsonResponse } from '@/server/http.mjs';
import { codexUsageStatus } from '@/server/settings-store.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return jsonResponse(await codexUsageStatus());
  } catch (error) {
    return errorResponse(error);
  }
}
