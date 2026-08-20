import { NextResponse } from 'next/server';
import { createMonitor, listMonitors } from '@/lib/monitors';

/** Lists the signed-in team's monitors. */
export async function GET() {
  try {
    return NextResponse.json({ success: true, data: await listMonitors() });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * Creates a monitor for the signed-in team.
 * @param request - JSON body with name, url, and intervalSeconds
 */
export async function POST(request: Request) {
  try {
    const monitor = await createMonitor(await request.json());
    return NextResponse.json({ success: true, data: monitor }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
