import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';

const SPOTIFY_BASE = 'https://api.spotify.com/v1';
const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0/';
const CLIENT_ID = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID!;
const LASTFM_KEY = process.env.LASTFM_API_KEY!;

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

async function lastfmGetSimilar(artist: string): Promise<string[]> {
  const url = new URL(LASTFM_BASE);
  url.searchParams.set('method', 'artist.getSimilar');
  url.searchParams.set('artist', artist);
  url.searchParams.set('limit', '30');
  url.searchParams.set('api_key', LASTFM_KEY);
  url.searchParams.set('format', 'json');
  try {
    const res = await fetch(url.toString());
    const data = await res.json();
    const arr = data?.similarartists?.artist;
    if (!Array.isArray(arr)) return [];
    return arr.map((a: any) => a.name);
  } catch {
    return [];
  }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
    if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

    // Get stored connection
    const { data: profile } = await supabase
      .from('profiles').select('id').eq('email', email.toLowerCase()).single();
    if (!profile) return NextResponse.json({ error: 'No profile found' }, { status: 404 });

    const { data: connection } = await supabase
      .from('connections').select('access_token, refresh_token, expires_at')
      .eq('user_id', profile.id).eq('service', 'spotify').single();
    if (!connection) return NextResponse.json({ error: 'No Spotify connection' }, { status: 404 });

    // Refresh token if needed
    let token = connection.access_token;
    if (Date.now() >= new Date(connection.expires_at).getTime() - 60_000) {
      try {
        token = await refreshAccessToken(connection.refresh_token);
        await supabase.from('connections')
          .update({ access_token: token, expires_at: new Date(Date.now() + 3600 * 1000).toISOString() })
          .eq('user_id', profile.id).eq('service', 'spotify');
      } catch {
        return NextResponse.json({ error: 'Token refresh failed' }, { status: 401 });
      }
    }

    // Get display name
    let displayName = 'friend';
    try {
      const me = await spotifyFetch<{ display_name?: string }>('/me', token);
      displayName = me.display_name || 'friend';
    } catch {}

    // 1. Get top artists from Spotify
    const topArtistNames: string[] = [];
    const knownNames = new Set<string>();
    const knownTrackIds = new Set<string>();

    const artistData = await spotifyFetch<{ items: { name: string }[] }>(
      '/me/top/artists?time_range=medium_term&limit=20', token
    ).catch(() => ({ items: [] }));

    for (const a of artistData.items) {
      topArtistNames.push(a.name);
      knownNames.add(a.name.toLowerCase());
    }

    const trackData = await spotifyFetch<{ items: { id: string; artists: { name: string }[] }[] }>(
      '/me/top/tracks?time_range=medium_term&limit=20', token
    ).catch(() => ({ items: [] }));

    for (const t of trackData.items) {
      knownTrackIds.add(t.id);
      for (const a of t.artists) knownNames.add(a.name.toLowerCase());
    }

    if (topArtistNames.length === 0) {
      return NextResponse.json({ error: 'No listening data' }, { status: 400 });
    }

    // 2. Get similar artists from Last.fm (just names, no scoring/tagging)
    const discovered: string[] = [];
    const seenDiscovered = new Set<string>();

    // Query Last.fm for top 10 seed artists in parallel
    const seeds = topArtistNames.slice(0, 10);
    const similarResults = await Promise.all(seeds.map(name => lastfmGetSimilar(name)));

    for (const similar of similarResults) {
      for (const name of similar) {
        const lower = name.toLowerCase();
        if (knownNames.has(lower) || seenDiscovered.has(lower)) continue;
        seenDiscovered.add(lower);
        discovered.push(name);
      }
    }

    if (discovered.length === 0) {
      return NextResponse.json({ error: 'No similar artists found' }, { status: 500 });
    }

    // 3. Shuffle and split into 5 groups for 5 playlists
    const shuffled = shuffle(discovered);
    const perOrbit = Math.ceil(shuffled.length / 5);
    const groups = Array.from({ length: 5 }, (_, i) =>
      shuffled.slice(i * perOrbit, (i + 1) * perOrbit)
    );

    // 4. For each group, search Spotify and create a playlist
    const globalSeenTracks = new Set<string>();
    const globalSeenArtists = new Set<string>();

    const savedPlaylists: {
      label: string;
      spotifyUrl: string;
      trackCount: number;
      tracks: { name: string; artist: string; url: string }[];
    }[] = [];

    for (let i = 0; i < 5; i++) {
      const group = groups[i];
      if (!group || group.length === 0) continue;

      const tracks: SpotifyTrack[] = [];

      // Search for each artist, pick one track
      for (const artistName of group.slice(0, 20)) {
        if (tracks.length >= 15) break;

        try {
          const q = encodeURIComponent(artistName);
          const data = await spotifyFetch<{ tracks: { items: SpotifyTrack[] } }>(
            `/search?q=${q}&type=track&limit=10`, token
          );

          const candidates = data.tracks.items.filter(t =>
            !globalSeenTracks.has(t.id) &&
            !knownTrackIds.has(t.id) &&
            !globalSeenArtists.has(t.artists[0]?.name.toLowerCase() ?? '')
          );
          if (candidates.length === 0) continue;

          // Pick a random track (not always the most popular)
          const pick = candidates[Math.floor(Math.random() * Math.min(candidates.length, 5))];
          globalSeenTracks.add(pick.id);
          globalSeenArtists.add(pick.artists[0]?.name.toLowerCase() ?? '');
          tracks.push(pick);
        } catch {}
      }

      if (tracks.length < 3) continue;

      // Create Spotify playlist
      try {
        const createRes = await fetch(`${SPOTIFY_BASE}/me/playlists`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `${ORBIT_NAMES[i]} · vyba`,
            description: ORBIT_DESCS[i],
            public: false,
          }),
        });
        if (!createRes.ok) continue;
        const playlist = await createRes.json();

        await fetch(`${SPOTIFY_BASE}/playlists/${playlist.id}/items`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ uris: tracks.map(t => t.uri) }),
        });

        savedPlaylists.push({
          label: ORBIT_NAMES[i],
          spotifyUrl: playlist.external_urls.spotify,
          trackCount: tracks.length,
          tracks: tracks.map(t => ({
            name: t.name,
            artist: t.artists.map(a => a.name).join(', '),
            url: t.external_urls.spotify,
          })),
        });
      } catch {}
    }

    if (savedPlaylists.length === 0) {
      return NextResponse.json({ error: 'Could not create playlists' }, { status: 500 });
    }

    // 5. Stats
    const totalTracks = savedPlaylists.reduce((s, p) => s + p.trackCount, 0);
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    const { data: yesterdayRow } = await supabase
      .from('discovery_stats').select('streak')
      .eq('email', email).eq('dig_date', yesterday).maybeSingle();

    const streak = yesterdayRow ? yesterdayRow.streak + 1 : 1;

    const uniqueArtists = new Set<string>();
    for (const pl of savedPlaylists) for (const t of pl.tracks) uniqueArtists.add(t.artist);

    await supabase.from('discovery_stats').upsert({
      email, dig_date: today,
      artists_discovered: uniqueArtists.size,
      tracks_discovered: totalTracks,
      playlists_created: savedPlaylists.length,
      genres_found: savedPlaylists.map(p => p.label),
      streak,
    }, { onConflict: 'email,dig_date' });

    const { data: allRows } = await supabase
      .from('discovery_stats').select('*').eq('email', email);
    let totalArtistsAll = 0;
    if (allRows) for (const row of allRows) totalArtistsAll += row.artists_discovered;

    // 6. Send email
    try {
      await fetch(new URL('/api/send-dig', req.url).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email, displayName,
          playlists: savedPlaylists,
          stats: { digNumber: allRows?.length ?? 1, artistsDiscovered: totalArtistsAll, streak },
        }),
      });
    } catch {}

    return NextResponse.json({ ok: true, playlists: savedPlaylists.length, tracks: totalTracks, savedPlaylists });
  } catch (err: unknown) {
    console.error('[vyba] /api/discover error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
