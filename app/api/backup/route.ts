import { requireUser, errorResponse } from '@/lib/product-server';
import { ProductError } from '@/lib/product-validation';
import { exportWorkspaceBackup } from '@/lib/backup-server';
import { BackupError, canonicalJson } from '@/lib/backup-format';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const user = await requireUser(), url = new URL(request.url);
    if ([...url.searchParams.keys()].some(key => key !== 'siteId') || url.searchParams.getAll('siteId').length !== 1) throw new ProductError(400, 'Select one workspace.', 'invalid_input');
    if (request.headers.get('sec-fetch-site') === 'cross-site') throw new ProductError(403, 'Download from this application.', 'invalid_origin');
    const siteId = url.searchParams.get('siteId')!;
    const backup = await exportWorkspaceBackup(user.userId, siteId);
    return new Response(canonicalJson(backup), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="lumen-backup-${siteId}-${backup.exportedAt.slice(0,10)}.json"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
  } catch (error) {
    if (error instanceof BackupError) return Response.json({ error: error.message, code: error.code, ...(error.issues ? { issues: error.issues } : {}) }, { status: error.status, headers: { 'Cache-Control': 'private, no-store' } });
    return errorResponse(error);
  }
}
