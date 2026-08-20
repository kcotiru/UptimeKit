import { NextResponse } from 'next/server';
import { createWebhook, listWebhooks } from '@/lib/webhooks';

/** Lists the signed-in team's notification webhooks. */
export async function GET() {
  try {
    return NextResponse.json({ success: true, data: await listWebhooks() });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * Creates a webhook for the signed-in team.
 * @param request - JSON body with provider and url
 */
export async function POST(request: Request) {
  try {
    const webhook = await createWebhook(await request.json());
    return NextResponse.json({ success: true, data: webhook }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
