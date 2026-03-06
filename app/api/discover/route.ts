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

// ============================
// Spotify helpers
// ============================

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

// ============================
// Last.fm helpers (direct server-side, no proxy needed)
// ============================

interface LfmSimilar { name: string; match: string; }

async function lastfmGetSimilar(artist: string, limit = 50): Promise<LfmSimilar[]> {
  const url = new URL(LASTFM_BASE);
  url.searchParams.set('method', 'artist.getSimilar');
  url.searchParams.set('artist', artist);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('api_key', LASTFM_KEY);
  url.searchParams.set('format', 'json');
  try {
    const res = await fetch(url.toString());
    const data = await res.json();
    const arr = data?.similarartists?.artist;
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

interface LfmTag { name: string; count: number; }

async function lastfmGetTags(artist: string): Promise<LfmTag[]> {
  const url = new URL(LASTFM_BASE);
  url.searchParams.set('method', 'artist.getTopTags');
  url.searchParams.set('artist', artist);
  url.searchParams.set('limit', '10');
  url.searchParams.set('api_key', LASTFM_KEY);
  url.searchParams.set('format', 'json');
  try {
    const res = await fetch(url.toString());
    const data = await res.json();
    const tags = data?.toptags?.tag;
    if (!Array.isArray(tags)) return [];
    return tags.map((t: any) => ({ name: t.name.toLowerCase(), count: Number(t.count) || 0 }));
  } catch {
    return [];
  }
}

// ============================
// Scoring & clustering
// ============================

interface ScoredArtist {
  name: string;
  score: number;
  seedCount: number;
  tags: string[];
}

function tagSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const tag of setA) if (setB.has(tag)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function clusterByTags(artists: ScoredArtist[], maxClusters: number): Map<number, ScoredArtist[]> {
  const clusters = new Map<number, { centroidTags: string[]; artists: ScoredArtist[] }>();
  let nextId = 0;
  const threshold = 0.15;

  for (const artist of artists) {
    if (artist.tags.length === 0) {
      if (clusters.size > 0) {
        const first = clusters.values().next().value!;
        first.artists.push(artist);
      } else {
        clusters.set(nextId++, { centroidTags: [], artists: [artist] });
      }
      continue;
    }

    let bestCluster = -1;
    let bestSim = -1;
    for (const [id, cluster] of clusters) {
      const sim = tagSimilarity(artist.tags, cluster.centroidTags);
      if (sim > bestSim) { bestSim = sim; bestCluster = id; }
    }

    if (bestSim >= threshold && bestCluster >= 0) {
      const cluster = clusters.get(bestCluster)!;
      cluster.artists.push(artist);
      const tagSet = new Set(cluster.centroidTags);
      for (const t of artist.tags) tagSet.add(t);
      cluster.centroidTags = Array.from(tagSet);
    } else if (clusters.size < maxClusters) {
      clusters.set(nextId++, { centroidTags: [...artist.tags], artists: [artist] });
    } else if (bestCluster >= 0) {
      clusters.get(bestCluster)!.artists.push(artist);
    }
  }

  const result = new Map<number, ScoredArtist[]>();
  for (const [id, cluster] of clusters) result.set(id, cluster.artists);
  return result;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandom<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

// ============================
// Spotify types
// ============================

interface SpotifyTrack {
  id: string;
  name: string;
  artists: { id: string; name: string }[];
  album: { name: string; images: { url: string }[] };
  uri: string;
  external_urls: { spotify: string };
  popularity: number;
}

// ============================
// Main route
// ============================

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

    // Get user's stored connection from Supabase
    const { data: profile } = await supabase
      .from('profiles').select('id').eq('email', email.toLowerCase()).single();
    if (!profile) return NextResponse.json({ error: 'No profile found' }, { status: 404 });

    const { data: connection } = await supabase
      .from('connections').select('access_token, refresh_token, expires_at, service')
      .eq('user_id', profile.id).eq('service', 'spotify').single();
    if (!connection) return NextResponse.json({ error: 'No Spotify connection' }, { status: 404 });

    // Get a valid access token
    let token = connection.access_token;
    const expiresAt = new Date(connection.expires_at).getTime();
    if (Date.now() >= expiresAt - 60_000) {
      try {
        token = await refreshAccessToken(connection.refresh_token);
        const newExpiry = new Date(Date.now() + 3600 * 1000).toISOString();
        await supabase.from('connections')
          .update({ access_token: token, expires_at: newExpiry })
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

    // ============================
    // Step 1: Get user's top artists (known music)
    // ============================
    const knownNames = new Set<string>();
    const knownTrackIds = new Set<string>();
    const topArtistNames: string[] = [];

    for (const range of ['short_term', 'medium_term', 'long_term']) {
      try {
        const data = await spotifyFetch<{ items: { id: string; name: string; genres?: string[] }[] }>(
          `/me/top/artists?time_range=${range}&limit=50`, token
        );
        for (const a of data.items) {
          const lower = a.name.toLowerCase();
          if (!knownNames.has(lower)) topArtistNames.push(a.name);
          knownNames.add(lower);
        }
      } catch {}

      try {
        const data = await spotifyFetch<{ items: { id: string; artists: { name: string }[] }[] }>(
          `/me/top/tracks?time_range=${range}&limit=50`, token
        );
        for (const t of data.items) {
          knownTrackIds.add(t.id);
          for (const a of t.artists) knownNames.add(a.name.toLowerCase());
        }
      } catch {}
    }

    if (topArtistNames.length === 0) {
      return NextResponse.json({ error: 'No listening data found' }, { status: 400 });
    }

    // ============================
    // Step 2: Discover new artists via Last.fm
    // ============================
    const seedArtists = topArtistNames.slice(0, 25);
    const rawDiscoveries = new Map<string, { sims: number[]; seeds: string[] }>();

    // Process seeds in batches of 5
    for (let i = 0; i < seedArtists.length; i += 5) {
      const batch = seedArtists.slice(i, i + 5);
      const results = await Promise.all(batch.map(name => lastfmGetSimilar(name, 50)));

      for (let j = 0; j < batch.length; j++) {
        const seedName = batch[j];
        const similar = results[j];
        for (const s of similar) {
          const lower = s.name.toLowerCase();
          if (knownNames.has(lower)) continue;
          const sim = parseFloat(s.match) || 0;
          const existing = rawDiscoveries.get(lower);
          if (existing) {
            existing.sims.push(sim);
            existing.seeds.push(seedName);
          } else {
            rawDiscoveries.set(lower, { sims: [sim], seeds: [seedName] });
          }
        }
      }
    }

    if (rawDiscoveries.size === 0) {
      return NextResponse.json({ error: 'No similar artists found' }, { status: 500 });
    }

    // Score artists: multi-seed boost
    const scoredArtists: ScoredArtist[] = [];
    for (const [name, data] of rawDiscoveries) {
      const maxSim = Math.max(...data.sims);
      const seedCount = data.seeds.length;
      const score = Math.min(maxSim * (1 + 0.15 * (seedCount - 1)), 1.5);
      scoredArtists.push({ name, score, seedCount, tags: [] });
    }
    scoredArtists.sort((a, b) => b.score - a.score);

    // ============================
    // Step 3: Get tags + cluster
    // ============================
    const toTag = scoredArtists.slice(0, 80);
    for (let i = 0; i < toTag.length; i += 5) {
      const batch = toTag.slice(i, i + 5);
      const tagResults = await Promise.all(batch.map(a => lastfmGetTags(a.name)));
      for (let j = 0; j < batch.length; j++) {
        batch[j].tags = tagResults[j].filter(t => t.count > 20).map(t => t.name);
      }
    }

    const clusters = clusterByTags(toTag, 8);
    const sortedClusters = Array.from(clusters.entries())
      .map(([id, artists]) => ({
        id, artists,
        totalScore: artists.reduce((s, a) => s + a.score, 0),
      }))
      .sort((a, b) => b.totalScore - a.totalScore);

    // ============================
    // Step 4: Search Spotify for tracks + build playlists
    // ============================
    const globalSeenTrackIds = new Set<string>();
    const globalSeenArtists = new Set<string>();

    const savedPlaylists: {
      label: string;
      spotifyUrl: string;
      trackCount: number;
      tracks: { name: string; artist: string; url: string }[];
    }[] = [];

    for (let orbitIdx = 0; orbitIdx < 5; orbitIdx++) {
      let orbitArtists: ScoredArtist[] = [];
      if (orbitIdx < sortedClusters.length) {
        orbitArtists = [...sortedClusters[orbitIdx].artists];
      } else {
        orbitArtists = toTag.filter(a => !globalSeenArtists.has(a.name.toLowerCase())).slice(0, 20);
      }

      // Add randomness, more for later orbits
      const temperature = 1.5 + orbitIdx * 0.5;
      orbitArtists.sort((a, b) => {
        return (b.score + Math.random() * temperature * 0.3) - (a.score + Math.random() * temperature * 0.3);
      });

      // Search Spotify for tracks
      const orbitTracks: SpotifyTrack[] = [];
      const artistsToSearch = orbitArtists.slice(0, 25);

      for (let i = 0; i < artistsToSearch.length; i += 3) {
        if (orbitTracks.length >= 15) break;
        const batch = artistsToSearch.slice(i, i + 3);
        const results = await Promise.allSettled(
          batch.map(a => {
            const q = encodeURIComponent(a.name);
            return spotifyFetch<{ tracks: { items: SpotifyTrack[] } }>(`/search?q=${q}&type=track&limit=20`, token);
          })
        );

        for (let j = 0; j < batch.length; j++) {
          if (orbitTracks.length >= 15) break;
          const result = results[j];
          if (result.status !== 'fulfilled') continue;
          const candidates = result.value.tracks.items.filter(t =>
            !globalSeenTrackIds.has(t.id) &&
            !knownTrackIds.has(t.id) &&
            !globalSeenArtists.has(t.artists[0]?.name.toLowerCase() ?? '')
          );
          if (candidates.length === 0) continue;

          // Prefer deeper cuts
          const deepCuts = candidates.filter(t => t.popularity <= 65);
          const pool = deepCuts.length >= 2 ? deepCuts : candidates;
          const pick = pickRandom(pool) ?? candidates[0];

          globalSeenTrackIds.add(pick.id);
          globalSeenArtists.add(pick.artists[0]?.name.toLowerCase() ?? '');
          orbitTracks.push(pick);
        }
      }

      if (orbitTracks.length < 3) continue;

      const shuffled = shuffle(orbitTracks);

      // Create Spotify playlist
      try {
        const createRes = await fetch(`${SPOTIFY_BASE}/me/playlists`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `${ORBIT_NAMES[orbitIdx]} · vyba`,
            description: ORBIT_DESCS[orbitIdx],
            public: false,
          }),
        });
        if (!createRes.ok) continue;
        const playlist = await createRes.json();

        const uris = shuffled.map(t => t.uri);
        await fetch(`${SPOTIFY_BASE}/playlists/${playlist.id}/items`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ uris }),
        });

        savedPlaylists.push({
          label: ORBIT_NAMES[orbitIdx],
          spotifyUrl: playlist.external_urls.spotify,
          trackCount: shuffled.length,
          tracks: shuffled.map(t => ({
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

    // ============================
    // Step 5: Track stats
    // ============================
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    const { data: yesterdayRow } = await supabase
      .from('discovery_stats').select('streak')
      .eq('email', email).eq('dig_date', yesterday).maybeSingle();

    const streak = yesterdayRow ? yesterdayRow.streak + 1 : 1;

    const uniqueArtists = new Set<string>();
    let totalTracks = 0;
    for (const pl of savedPlaylists) {
      for (const t of pl.tracks) uniqueArtists.add(t.artist);
      totalTracks += pl.trackCount;
    }

    await supabase.from('discovery_stats').upsert({
      email,
      dig_date: today,
      artists_discovered: uniqueArtists.size,
      tracks_discovered: totalTracks,
      playlists_created: savedPlaylists.length,
      genres_found: savedPlaylists.map(p => p.label),
      streak,
    }, { onConflict: 'email,dig_date' });

    // Cumulative stats for email
    const { data: allRows } = await supabase
      .from('discovery_stats').select('*').eq('email', email);

    let totalArtistsAll = 0;
    const totalDigs = allRows?.length ?? 0;
    if (allRows) {
      for (const row of allRows) totalArtistsAll += row.artists_discovered;
    }

    // ============================
    // Step 6: Send email
    // ============================
    try {
      await fetch(new URL('/api/send-dig', req.url).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          displayName,
          playlists: savedPlaylists,
          stats: { digNumber: totalDigs, artistsDiscovered: totalArtistsAll, streak },
        }),
      });
    } catch {}

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
