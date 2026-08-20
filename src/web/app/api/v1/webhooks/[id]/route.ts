import { NextResponse } from 'next/server';
import { deleteWebhook } from '@/lib/webhooks';

/**
 * Soft deletes a webhook.
 * @param _request - Incoming request object
 * @param params - URL parameters object containing target webhook ID
 */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const deleted = await deleteWebhook(params.id);
    if (!deleted) {
      return NextResponse.json({ success: false, error: 'Webhook not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
