import { archiveOverview } from '@/server/archive-manager.mjs';
import { errorResponse, jsonResponse } from '@/server/http.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return jsonResponse(await archiveOverview());
  } catch (error) {
    return errorResponse(error);
  }
}
