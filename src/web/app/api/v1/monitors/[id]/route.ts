import { NextResponse } from 'next/server';
import { deleteMonitor, getMonitor } from '@/lib/monitors';

/**
 * Fetches a single monitor.
 * @param _request - Incoming request object
 * @param params - URL parameters object containing target monitor ID
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const monitor = await getMonitor(params.id);
    if (!monitor) {
      return NextResponse.json({ success: false, error: 'Monitor not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: monitor });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * Soft deletes a monitor.
 * @param _request - Incoming request object
 * @param params - URL parameters object containing target monitor ID
 */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const deleted = await deleteMonitor(params.id);
    if (!deleted) {
      return NextResponse.json({ success: false, error: 'Monitor not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
