import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';

export async function POST() {
  await supabaseServer().auth.signOut();
  return NextResponse.json({ success: true });
}
