import { supabase } from './client';

export async function saveSpotifyConnection(
  email: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  spotifyUserId: string,
  timezone?: string,
) {
  const upsertData: Record<string, string> = { email: email.toLowerCase() };
  if (timezone) upsertData.timezone = timezone;

  const { data: profile } = await supabase
    .from('profiles')
    .upsert(upsertData, { onConflict: 'email' })
    .select('id')
    .single();

  if (!profile) return;

  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  await supabase
    .from('connections')
    .upsert({
      user_id: profile.id,
      service: 'spotify' as const,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      service_user_id: spotifyUserId,
    }, { onConflict: 'user_id,service' });
}

export async function saveDeezerConnection(
  email: string,
  accessToken: string,
) {
  const { data: profile } = await supabase
    .from('profiles')
    .upsert({ email: email.toLowerCase() }, { onConflict: 'email' })
    .select('id')
    .single();

  if (!profile) return;

  await supabase
    .from('connections')
    .upsert({
      user_id: profile.id,
      service: 'deezer' as const,
      access_token: accessToken,
      refresh_token: null,
      expires_at: null,
    }, { onConflict: 'user_id,service' });
}
