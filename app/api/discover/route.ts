import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';

const SPOTIFY_BASE = 'https://api.spotify.com/v1';
const CLIENT_ID = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID!;

const ORBIT_NAMES = ['warm signal', 'soft drift', 'night drive', 'other side', 'static'];
const ORBIT_DESCS = [
  'Closest to your taste — familiar energy, new names.',
  'A gentle stretch from your usual listening.',
  'Deeper, darker, further out.',
  'Completely different energy.',
  'The outer edge. Experimental. Uncharted.',
];

async function spotifyFetch<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${SPOTIFY_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error('TOKEN_EXPIRED');
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Spotify ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  });
  if (!res.ok) throw new Error('Failed to refresh token');
  const data = await res.json();
  return data.access_token;
}

interface SpotifyTrack {
  id: string;
  name: string;
  artists: { id: string; name: string }[];
  album: { name: string; images: { url: string }[] };
  uri: string;
  external_urls: { spotify: string };
  popularity: number;
}

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ error: 'email required' }, { status: 400 });
    }

    // Get user's stored connection from Supabase
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    if (!profile) {
      return NextResponse.json({ error: 'No profile found' }, { status: 404 });
    }

    const { data: connection } = await supabase
      .from('connections')
      .select('access_token, refresh_token, expires_at, service')
      .eq('user_id', profile.id)
      .eq('service', 'spotify')
      .single();

    if (!connection) {
      return NextResponse.json({ error: 'No Spotify connection' }, { status: 404 });
    }

    // Get a valid access token (refresh if expired)
    let token = connection.access_token;
    const expiresAt = new Date(connection.expires_at).getTime();
    if (Date.now() >= expiresAt - 60_000) {
      try {
        token = await refreshAccessToken(connection.refresh_token);
        // Update stored token
        const newExpiry = new Date(Date.now() + 3600 * 1000).toISOString();
        await supabase
          .from('connections')
          .update({ access_token: token, expires_at: newExpiry })
          .eq('user_id', profile.id)
          .eq('service', 'spotify');
      } catch {
        return NextResponse.json({ error: 'Token refresh failed' }, { status: 401 });
      }
    }

    // Get user's display name
    let displayName = 'friend';
    try {
      const me = await spotifyFetch<{ display_name?: string }>('/me', token);
      displayName = me.display_name || 'friend';
    } catch { /* use default */ }

    // Step 1: Get user's top artists and tracks
    const [topArtists, topTracks] = await Promise.all([
      spotifyFetch<{ items: { id: string; name: string }[] }>(
        '/me/top/artists?time_range=medium_term&limit=20', token
      ).catch(() => ({ items: [] })),
      spotifyFetch<{ items: { id: string; name: string }[] }>(
        '/me/top/tracks?time_range=medium_term&limit=20', token
      ).catch(() => ({ items: [] })),
    ]);

    const artistIds = topArtists.items.map(a => a.id);
    const trackIds = topTracks.items.map(t => t.id);

    if (artistIds.length === 0 && trackIds.length === 0) {
      return NextResponse.json({ error: 'No listening data' }, { status: 400 });
    }

    // Step 2: Get recommendations for each orbit using different seed combos
    const knownTrackIds = new Set(trackIds);
    const allPlaylistData: {
      label: string;
      description: string;
      tracks: SpotifyTrack[];
      url?: string;
    }[] = [];

    for (let i = 0; i < 5; i++) {
      const seedOffset = i * 3;
      const seedArtists = artistIds.slice(seedOffset, seedOffset + 2);
      const seedTracks = trackIds.slice(seedOffset, seedOffset + 1);

      // Fallback seeds if we've run out
      const finalArtists = seedArtists.length > 0 ? seedArtists : artistIds.slice(0, 2);
      const finalTracks = seedTracks.length > 0 ? seedTracks : trackIds.slice(0, 1);

      const params = new URLSearchParams({ limit: '20' });
      if (finalArtists.length > 0) params.set('seed_artists', finalArtists.join(','));
      if (finalTracks.length > 0) params.set('seed_tracks', finalTracks.join(','));

      // Ensure we have at least one seed
      if (!params.has('seed_artists') && !params.has('seed_tracks')) continue;

      try {
        const recs = await spotifyFetch<{ tracks: SpotifyTrack[] }>(
          `/recommendations?${params.toString()}`, token
        );

        // Filter out known tracks and dedupe across orbits
        const fresh = recs.tracks.filter(t => {
          if (knownTrackIds.has(t.id)) return false;
          knownTrackIds.add(t.id);
          return true;
        });

        if (fresh.length >= 3) {
          allPlaylistData.push({
            label: ORBIT_NAMES[i],
            description: ORBIT_DESCS[i],
            tracks: fresh.slice(0, 15),
          });
        }
      } catch {
        // Skip this orbit
      }
    }

    if (allPlaylistData.length === 0) {
      return NextResponse.json({ error: 'Could not generate playlists' }, { status: 500 });
    }

    // Step 3: Create Spotify playlists
    const savedPlaylists: {
      label: string;
      spotifyUrl: string;
      trackCount: number;
      tracks: { name: string; artist: string; url: string }[];
    }[] = [];

    for (const pl of allPlaylistData) {
      try {
        // Create playlist
        const createRes = await fetch(`${SPOTIFY_BASE}/me/playlists`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `${pl.label} · vyba`,
            description: pl.description,
            public: false,
          }),
        });
        if (!createRes.ok) continue;
        const playlist = await createRes.json();

        // Add tracks
        const uris = pl.tracks.map(t => t.uri);
        await fetch(`${SPOTIFY_BASE}/playlists/${playlist.id}/items`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ uris }),
        });

        savedPlaylists.push({
          label: pl.label,
          spotifyUrl: playlist.external_urls.spotify,
          trackCount: pl.tracks.length,
          tracks: pl.tracks.map(t => ({
            name: t.name,
            artist: t.artists.map(a => a.name).join(', '),
            url: t.external_urls.spotify,
          })),
        });
      } catch {
        // Skip this playlist
      }
    }

    if (savedPlaylists.length === 0) {
      return NextResponse.json({ error: 'Could not create playlists' }, { status: 500 });
    }

    // Step 4: Track stats
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    const { data: yesterdayRow } = await supabase
      .from('discovery_stats')
      .select('streak')
      .eq('email', email)
      .eq('dig_date', yesterday)
      .maybeSingle();

    const streak = yesterdayRow ? yesterdayRow.streak + 1 : 1;

    const uniqueArtists = new Set<string>();
    let totalTracks = 0;
    for (const pl of savedPlaylists) {
      for (const t of pl.tracks) uniqueArtists.add(t.artist);
      totalTracks += pl.trackCount;
    }

    await supabase
      .from('discovery_stats')
      .upsert({
        email,
        dig_date: today,
        artists_discovered: uniqueArtists.size,
        tracks_discovered: totalTracks,
        playlists_created: savedPlaylists.length,
        genres_found: savedPlaylists.map(p => p.label),
        streak,
      }, { onConflict: 'email,dig_date' });

    // Get cumulative stats for email
    const { data: allRows } = await supabase
      .from('discovery_stats')
      .select('*')
      .eq('email', email);

    let totalArtistsAll = 0;
    let totalDigs = allRows?.length ?? 0;
    if (allRows) {
      for (const row of allRows) totalArtistsAll += row.artists_discovered;
    }

    // Step 5: Send email
    try {
      await fetch(new URL('/api/send-dig', req.url).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          displayName,
          playlists: savedPlaylists,
          stats: {
            digNumber: totalDigs,
            artistsDiscovered: totalArtistsAll,
            streak,
          },
        }),
      });
    } catch {
      // Email is non-blocking
    }

    return NextResponse.json({
      ok: true,
      playlists: savedPlaylists.length,
      tracks: totalTracks,
      savedPlaylists,
    });
  } catch (err: unknown) {
    console.error('[vyba] /api/discover error:', err);
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
