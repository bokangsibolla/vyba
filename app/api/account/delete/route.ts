import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';

export async function POST(request: Request) {
  const { email } = await request.json();

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email.toLowerCase())
    .single();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  // Delete connections first, then profile
  await supabase.from('connections').delete().eq('user_id', profile.id);
  await supabase.from('daily_issues').delete().eq('user_id', profile.id);
  await supabase.from('profiles').delete().eq('id', profile.id);

  return NextResponse.json({ deleted: true });
}
