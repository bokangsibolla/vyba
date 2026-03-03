import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async () => {
  // Get all users with active connections
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, display_name, issue_number, connections(service, access_token, refresh_token, expires_at)')
    .not('connections', 'is', null);

  if (!profiles || profiles.length === 0) {
    return new Response(JSON.stringify({ processed: 0 }));
  }

  let processed = 0;

  for (const profile of profiles) {
    try {
      const connections = (profile as any).connections ?? [];
      if (connections.length === 0) continue;

      // Get active token (refresh if needed)
      const conn = connections[0];
      let token = conn.access_token;

      if (conn.service === 'spotify' && conn.expires_at) {
        const expiresAt = new Date(conn.expires_at).getTime();
        if (Date.now() >= expiresAt - 300000) {
          token = await refreshSpotifyToken(conn.refresh_token, profile.id);
        }
      }

      const issueNumber = (profile.issue_number ?? 0) + 1;

      // Update issue number
      await supabase.from('profiles').update({ issue_number: issueNumber }).eq('id', profile.id);

      // Send email via Resend
      const RESEND_KEY = Deno.env.get('RESEND_API_KEY');
      if (RESEND_KEY) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'VYBA <dj@vyba.app>',
            to: profile.email,
            subject: `VYBA #${String(issueNumber).padStart(3, '0')} — Your Daily Dig`,
            html: buildPlaceholderEmail(issueNumber, profile.display_name ?? 'friend'),
          }),
        });
      }

      processed++;
    } catch (error) {
      console.error(`Failed for user ${profile.id}:`, error);
    }
  }

  return new Response(JSON.stringify({ processed }));
});

async function refreshSpotifyToken(refreshToken: string, userId: string): Promise<string> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: Deno.env.get('SPOTIFY_CLIENT_ID')!,
    }),
  });

  const data = await res.json();

  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  await supabase
    .from('connections')
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? refreshToken,
      expires_at: expiresAt,
    })
    .eq('user_id', userId)
    .eq('service', 'spotify');

  return data.access_token;
}

function buildPlaceholderEmail(issueNumber: number, name: string): string {
  return `
    <div style="font-family: 'Inter', Arial, sans-serif; background: #FFFDF5; padding: 32px; max-width: 560px; margin: 0 auto;">
      <h1 style="font-family: 'Space Mono', monospace; font-size: 24px; letter-spacing: 0.08em; color: #111;">VYBA</h1>
      <p style="font-family: 'Space Mono', monospace; font-size: 11px; color: #FF4D00; letter-spacing: 0.1em; text-transform: uppercase;">
        Issue #${String(issueNumber).padStart(3, '0')}
      </p>
      <hr style="border: 1px solid #111; margin: 16px 0;" />
      <p style="font-size: 15px; color: #111; line-height: 1.6;">
        Yo ${name}. Your daily dig is ready — head to <a href="https://vyba.vercel.app/today" style="color: #FF4D00;">vyba.vercel.app/today</a> to listen.
      </p>
      <hr style="border: 1px solid #E5DDD0; margin: 24px 0;" />
      <p style="font-family: 'Space Mono', monospace; font-size: 11px; color: #B5AFA5; text-align: center;">
        <a href="https://vyba.vercel.app/today" style="color: #6B6B6B;">View in browser</a>
      </p>
    </div>
  `;
}
