import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const LASTFM_KEY = Deno.env.get('LASTFM_API_KEY')!;
const SPOTIFY_CLIENT_ID = Deno.env.get('SPOTIFY_CLIENT_ID')!;
const BREVO_KEY = Deno.env.get('BREVO_API_KEY') ?? '';

const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0/';
const SPOTIFY_BASE = 'https://api.spotify.com/v1';

const TARGET_PER_ORBIT = 15;
const ORBIT_IDS = ['warmsignal', 'softdrift', 'nightdrive', 'otherside', 'static'] as const;

const SECTION_META: Record<string, { label: string; tagline: string; bg: string; accent: string }> = {
  warmsignal:  { label: 'warm signal',  tagline: 'Artists closest to your frequency', bg: '#3A2E1A', accent: '#D4A853' },
  softdrift:   { label: 'soft drift',   tagline: 'A gentle stretch from your usual',  bg: '#1E2E1A', accent: '#7A9B5A' },
  nightdrive:  { label: 'night drive',  tagline: 'Deeper cuts, darker moods',         bg: '#3A2218', accent: '#E8622B' },
  otherside:   { label: 'other side',   tagline: 'Different energy entirely',          bg: '#1A2A30', accent: '#5A9B9B' },
  static:      { label: 'static',       tagline: 'The furthest out we could find',     bg: '#30192A', accent: '#C45A8A' },
};

// ===== Spotify helpers =====

async function spotifyFetch<T>(token: string, path: string, retries = 2): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${SPOTIFY_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 429) {
      const wait = Math.max(parseInt(res.headers.get('Retry-After') || '3'), 2) * 1000;
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`Spotify ${res.status} ${path.slice(0, 60)}`);
    return res.json();
  }
  throw new Error('Spotify rate limited');
}

interface SpotifyTrack {
  id: string;
  name: string;
  artists: { id: string; name: string }[];
  album: { name: string; images: { url: string }[] };
  uri: string;
  external_urls: { spotify: string };
}

interface SpotifyArtist {
  id: string;
  name: string;
  genres: string[];
}

async function getTopArtists(token: string, range: string, limit = 50): Promise<SpotifyArtist[]> {
  const data = await spotifyFetch<{ items: SpotifyArtist[] }>(
    token, `/me/top/artists?time_range=${range}&limit=${limit}`
  );
  return data.items ?? [];
}

async function getTopTrackIds(token: string, range: string): Promise<Set<string>> {
  try {
    const data = await spotifyFetch<{ items: { id: string; artists: { name: string }[] }[] }>(
      token, `/me/top/tracks?time_range=${range}&limit=50`
    );
    return new Set(data.items.map(t => t.id));
  } catch { return new Set(); }
}

async function searchTracks(token: string, query: string): Promise<SpotifyTrack[]> {
  const q = encodeURIComponent(query);
  const data = await spotifyFetch<{ tracks: { items: SpotifyTrack[] } }>(
    token, `/search?q=${q}&type=track`
  );
  return data.tracks?.items ?? [];
}

async function createPlaylist(token: string, name: string, description: string, uris: string[]): Promise<{ id: string; url: string }> {
  const createRes = await fetch(`${SPOTIFY_BASE}/me/playlists`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, public: false }),
  });
  if (!createRes.ok) throw new Error(`Create playlist ${createRes.status}`);
  const pl = await createRes.json();

  const uniqueUris = [...new Set(uris)];
  await fetch(`${SPOTIFY_BASE}/playlists/${pl.id}/items`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: uniqueUris }),
  });

  return { id: pl.id, url: pl.external_urls.spotify };
}

// ===== Last.fm helpers =====

interface SimilarArtist { name: string; match: string }
interface ArtistTag { name: string; count: number }

async function lastfmSimilar(artist: string, limit = 50): Promise<SimilarArtist[]> {
  try {
    const params = new URLSearchParams({
      method: 'artist.getSimilar',
      artist,
      api_key: LASTFM_KEY,
      format: 'json',
      limit: String(limit),
    });
    const res = await fetch(`${LASTFM_BASE}?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data?.similarartists?.artist ?? [];
  } catch { return []; }
}

async function lastfmTags(artist: string): Promise<ArtistTag[]> {
  try {
    const params = new URLSearchParams({
      method: 'artist.getTopTags',
      artist,
      api_key: LASTFM_KEY,
      format: 'json',
      limit: '10',
    });
    const res = await fetch(`${LASTFM_BASE}?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.toptags?.tag ?? []).map((t: { name: string; count: number }) => ({
      name: t.name.toLowerCase(),
      count: Number(t.count) || 0,
    }));
  } catch { return []; }
}

// ===== Discovery engine (simplified for server) =====

interface ScoredArtist {
  name: string;
  score: number;
  seedCount: number;
  tags: string[];
}

function tagSimilarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

function clusterByTags(artists: ScoredArtist[], maxClusters: number): Map<number, ScoredArtist[]> {
  const clusters = new Map<number, { tags: string[]; artists: ScoredArtist[] }>();
  let nextId = 0;

  for (const artist of artists) {
    if (artist.tags.length === 0) {
      if (clusters.size > 0) {
        const first = clusters.values().next().value;
        if (first) first.artists.push(artist);
      } else {
        clusters.set(nextId++, { tags: [], artists: [artist] });
      }
      continue;
    }

    let bestId = -1, bestSim = -1;
    for (const [id, c] of clusters) {
      const sim = tagSimilarity(artist.tags, c.tags);
      if (sim > bestSim) { bestSim = sim; bestId = id; }
    }

    if (bestSim >= 0.15 && bestId >= 0) {
      const c = clusters.get(bestId)!;
      c.artists.push(artist);
      const tagSet = new Set(c.tags);
      for (const t of artist.tags) tagSet.add(t);
      c.tags = [...tagSet];
    } else if (clusters.size < maxClusters) {
      clusters.set(nextId++, { tags: [...artist.tags], artists: [artist] });
    } else if (bestId >= 0) {
      clusters.get(bestId)!.artists.push(artist);
    }
  }

  const result = new Map<number, ScoredArtist[]>();
  for (const [id, c] of clusters) result.set(id, c.artists);
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

interface OrbitResult {
  id: string;
  label: string;
  tracks: { name: string; artist: string; uri: string; url: string }[];
  spotifyUrl: string;
}

async function runEngine(token: string): Promise<OrbitResult[]> {
  // Step 1: Build taste profile
  const knownNames = new Set<string>();
  const knownTrackIds = new Set<string>();
  const topArtistNames: string[] = [];

  for (const range of ['short_term', 'medium_term', 'long_term']) {
    try {
      const artists = await getTopArtists(token, range);
      for (const a of artists) {
        const lower = a.name.toLowerCase();
        if (!knownNames.has(lower)) topArtistNames.push(a.name);
        knownNames.add(lower);
      }
    } catch { /* continue */ }

    try {
      const ids = await getTopTrackIds(token, range);
      for (const id of ids) knownTrackIds.add(id);
    } catch { /* continue */ }
  }

  if (topArtistNames.length === 0) throw new Error('No listening data');

  // Step 2: Discover via Last.fm (rate limit: 1 req/sec batched)
  const seedArtists = topArtistNames.slice(0, 20);
  const rawDiscoveries = new Map<string, { sims: number[]; seeds: string[] }>();

  for (let i = 0; i < seedArtists.length; i += 3) {
    const batch = seedArtists.slice(i, i + 3);
    const results = await Promise.all(batch.map(n => lastfmSimilar(n, 40)));
    for (let j = 0; j < batch.length; j++) {
      for (const s of results[j]) {
        const lower = s.name.toLowerCase();
        if (knownNames.has(lower)) continue;
        const sim = parseFloat(s.match) || 0;
        const existing = rawDiscoveries.get(lower);
        if (existing) {
          existing.sims.push(sim);
          existing.seeds.push(batch[j]);
        } else {
          rawDiscoveries.set(lower, { sims: [sim], seeds: [batch[j]] });
        }
      }
    }
    // Small delay between Last.fm batches
    if (i + 3 < seedArtists.length) await new Promise(r => setTimeout(r, 350));
  }

  if (rawDiscoveries.size === 0) throw new Error('No discoveries from Last.fm');

  // Multi-seed scoring
  const scored: ScoredArtist[] = [];
  for (const [name, data] of rawDiscoveries) {
    const maxSim = Math.max(...data.sims);
    const seedCount = data.seeds.length;
    scored.push({
      name,
      score: Math.min(maxSim * (1 + 0.15 * (seedCount - 1)), 1.5),
      seedCount,
      tags: [],
    });
  }
  scored.sort((a, b) => b.score - a.score);

  // Step 3: Tag top artists + cluster
  const toTag = scored.slice(0, 60);
  for (let i = 0; i < toTag.length; i += 4) {
    const batch = toTag.slice(i, i + 4);
    const tagResults = await Promise.all(batch.map(a => lastfmTags(a.name)));
    for (let j = 0; j < batch.length; j++) {
      batch[j].tags = tagResults[j].filter(t => t.count > 20).map(t => t.name);
    }
    if (i + 4 < toTag.length) await new Promise(r => setTimeout(r, 250));
  }

  const clusters = clusterByTags(toTag, 8);
  const sortedClusters = [...clusters.entries()]
    .map(([id, artists]) => ({ id, artists, totalScore: artists.reduce((s, a) => s + a.score, 0) }))
    .sort((a, b) => b.totalScore - a.totalScore);

  // Step 4: Search Spotify + create playlists
  const orbits: OrbitResult[] = [];
  const seenTracks = new Set<string>();
  const seenArtists = new Set<string>();

  for (let idx = 0; idx < ORBIT_IDS.length; idx++) {
    const orbitId = ORBIT_IDS[idx];
    const meta = SECTION_META[orbitId];
    let artists: ScoredArtist[] = [];

    if (idx < sortedClusters.length) {
      artists = [...sortedClusters[idx].artists];
    } else {
      artists = toTag.filter(a => !seenArtists.has(a.name.toLowerCase())).slice(0, 15);
    }

    // Add noise for variety
    const temp = 1.5 + idx * 0.5;
    artists.sort((a, b) => (b.score + Math.random() * temp * 0.3) - (a.score + Math.random() * temp * 0.3));

    const tracks: { name: string; artist: string; uri: string; url: string }[] = [];
    const searchBatch = artists.slice(0, 20);

    for (let i = 0; i < searchBatch.length; i += 3) {
      if (tracks.length >= TARGET_PER_ORBIT) break;
      const batch = searchBatch.slice(i, i + 3);
      const results = await Promise.allSettled(
        batch.map(a => searchTracks(token, `artist:"${a.name}"`))
      );

      for (let j = 0; j < batch.length; j++) {
        if (tracks.length >= TARGET_PER_ORBIT) break;
        const r = results[j];
        if (r.status !== 'fulfilled' || !r.value.length) continue;

        const candidates = r.value.filter(t =>
          !seenTracks.has(t.id) &&
          !knownTrackIds.has(t.id) &&
          !knownNames.has(t.artists[0]?.name.toLowerCase() ?? '') &&
          !seenArtists.has(t.artists[0]?.name.toLowerCase() ?? '')
        );
        if (!candidates.length) continue;

        const deep = candidates.slice(1);
        const pick = deep.length > 0 ? deep[Math.floor(Math.random() * deep.length)] : candidates[0];
        seenTracks.add(pick.id);
        seenArtists.add(pick.artists[0]?.name.toLowerCase() ?? '');
        tracks.push({
          name: pick.name,
          artist: pick.artists.map(a => a.name).join(', '),
          uri: pick.uri,
          url: pick.external_urls.spotify,
        });
      }
    }

    if (tracks.length >= 5) {
      const shuffled = shuffle(tracks);
      try {
        const pl = await createPlaylist(
          token,
          `${meta.label} · vyba`,
          meta.tagline,
          shuffled.map(t => t.uri)
        );
        orbits.push({ id: orbitId, label: meta.label, tracks: shuffled, spotifyUrl: pl.url });
      } catch (e) {
        console.error(`Playlist create failed for ${orbitId}:`, e);
      }
    }
  }

  return orbits;
}

// ===== Token refresh =====

async function refreshSpotifyToken(refreshToken: string, userId: string): Promise<string> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: SPOTIFY_CLIENT_ID,
    }),
  });

  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
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

// ===== Email =====

function buildEmailHtml(
  name: string,
  orbits: OrbitResult[],
  stats: { digNumber: number; streak: number; totalArtists: number },
): string {
  const totalTracks = orbits.reduce((s, o) => s + o.tracks.length, 0);

  const sections = orbits.map(o => {
    const meta = SECTION_META[o.id] ?? { bg: '#2F2A22', accent: '#8A7E6E' };
    const preview = o.tracks.slice(0, 3).map(t =>
      `<span style="font-family:Arial,sans-serif;font-size:13px;color:#F0DFC8;">${t.name}</span> <span style="font-family:Arial,sans-serif;font-size:11px;color:#8A7E6E;">- ${t.artist}</span>`
    ).join('<br/>');

    return `<div style="border:1px solid #2E2924;border-radius:10px;overflow:hidden;margin-bottom:14px;background:#211E18;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr><td style="background:${meta.bg};padding:10px 16px;">
          <div style="font-family:Courier,monospace;font-size:12px;font-weight:700;letter-spacing:0.1em;color:${meta.accent};text-transform:uppercase;">${o.label}</div>
        </td></tr>
        <tr><td style="padding:12px 16px;">${preview}</td></tr>
        ${o.spotifyUrl ? `<tr><td style="padding:0 16px 14px;">
          <a href="${o.spotifyUrl}" style="display:inline-block;font-family:Courier,monospace;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#1A1714;background:${meta.accent};padding:8px 16px;border-radius:6px;text-decoration:none;">Open playlist</a>
        </td></tr>` : ''}
      </table>
    </div>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#1A1714;">
<div style="max-width:560px;margin:0 auto;padding:40px 20px;font-family:Arial,sans-serif;">
  <div style="font-family:Courier,monospace;font-size:22px;font-weight:700;letter-spacing:0.08em;color:#E8622B;margin:0 0 32px;">VYBA</div>
  <p style="font-family:Courier,monospace;font-size:12px;color:#5A5347;letter-spacing:0.06em;text-transform:uppercase;margin:0 0 20px;">Dig #${stats.digNumber}. ${stats.streak} day streak.</p>
  <p style="font-family:Georgia,serif;font-size:22px;font-weight:400;color:#F0DFC8;margin:0 0 6px;line-height:1.3;">Hey ${name}.</p>
  <p style="font-family:Georgia,serif;font-size:16px;font-weight:400;color:#A89E8E;margin:0 0 28px;line-height:1.5;">We went through your listening and pulled ${totalTracks} songs you've never heard. ${orbits.length} playlists, all new artists.</p>
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 28px;border:1px solid #2E2924;border-radius:10px;overflow:hidden;background:#1E1B17;">
    <tr>
      <td style="padding:20px 24px;text-align:center;">
        <div style="font-family:Georgia,serif;font-size:36px;color:#F0DFC8;line-height:1;">${stats.totalArtists}</div>
        <div style="font-family:Courier,monospace;font-size:10px;color:#5A5347;letter-spacing:0.1em;text-transform:uppercase;margin-top:4px;">artists discovered</div>
      </td>
      <td style="padding:20px 24px;text-align:center;border-left:1px solid #2E2924;">
        <div style="font-family:Courier,monospace;font-size:20px;font-weight:700;color:${stats.streak > 1 ? '#E8622B' : '#F0DFC8'};line-height:1;">${stats.streak}</div>
        <div style="font-family:Courier,monospace;font-size:10px;color:#5A5347;letter-spacing:0.1em;text-transform:uppercase;margin-top:4px;">day streak</div>
      </td>
      <td style="padding:20px 24px;text-align:center;border-left:1px solid #2E2924;">
        <div style="font-family:Courier,monospace;font-size:20px;font-weight:700;color:#F0DFC8;line-height:1;">#${stats.digNumber}</div>
        <div style="font-family:Courier,monospace;font-size:10px;color:#5A5347;letter-spacing:0.1em;text-transform:uppercase;margin-top:4px;">dig</div>
      </td>
    </tr>
  </table>
  ${sections}
  <p style="font-family:Courier,monospace;font-size:11px;color:#3D362C;text-align:center;letter-spacing:0.06em;margin:32px 0 0;">vyba</p>
</div></body></html>`;
}

async function sendEmail(email: string, name: string, orbits: OrbitResult[], stats: { digNumber: number; streak: number; totalArtists: number }) {
  if (!BREVO_KEY) return;
  const html = buildEmailHtml(name, orbits, stats);
  await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { name: 'VYBA', email: 'sibollabokang@gmail.com' },
      to: [{ email }],
      subject: `dig #${stats.digNumber} is ready`,
      htmlContent: html,
    }),
  });
}

// ===== Timezone filtering =====

function isDeliveryHour(timezone: string, targetHour = 7): boolean {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    const localHour = parseInt(formatter.format(now), 10);
    return localHour === targetHour;
  } catch {
    // Invalid timezone, fall back to UTC check
    return new Date().getUTCHours() === targetHour;
  }
}

// ===== Main handler =====

Deno.serve(async () => {
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, display_name, timezone, connections(service, access_token, refresh_token, expires_at)')
    .not('connections', 'is', null);

  if (!profiles?.length) {
    return new Response(JSON.stringify({ processed: 0, skipped: 0, errors: [] }));
  }

  // Filter to only users where it's currently 7am in their timezone
  const eligible = profiles.filter(p => {
    const tz = (p.timezone as string) || 'UTC';
    return isDeliveryHour(tz, 7);
  });

  if (eligible.length === 0) {
    return new Response(JSON.stringify({
      processed: 0,
      skipped: profiles.length,
      reason: 'No users in the 7am delivery window right now',
      errors: [],
    }));
  }

  let processed = 0;
  const errors: string[] = [];

  for (const profile of eligible) {
    try {
      const connections = (profile as Record<string, unknown>).connections as { service: string; access_token: string; refresh_token: string; expires_at: string }[] ?? [];
      const conn = connections.find((c) => c.service === 'spotify');
      if (!conn) continue;

      // Refresh token if expired or close to expiring
      let token = conn.access_token;
      if (conn.expires_at) {
        const expiresAt = new Date(conn.expires_at).getTime();
        if (Date.now() >= expiresAt - 300_000) {
          token = await refreshSpotifyToken(conn.refresh_token, profile.id);
        }
      }

      // Run discovery engine
      const orbits = await runEngine(token);
      if (orbits.length === 0) {
        errors.push(`${profile.email}: no playlists generated`);
        continue;
      }

      // Track stats
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

      const { data: yesterdayRow } = await supabase
        .from('discovery_stats')
        .select('streak')
        .eq('email', profile.email)
        .eq('dig_date', yesterday)
        .maybeSingle();

      const streak = yesterdayRow ? yesterdayRow.streak + 1 : 1;
      const uniqueArtists = new Set(orbits.flatMap(o => o.tracks.map(t => t.artist)));
      const totalTracks = orbits.reduce((s, o) => s + o.tracks.length, 0);
      const genres = orbits.map(o => o.label);

      await supabase.from('discovery_stats').upsert({
        email: profile.email,
        dig_date: today,
        artists_discovered: uniqueArtists.size,
        tracks_discovered: totalTracks,
        playlists_created: orbits.length,
        genres_found: genres,
        streak,
      }, { onConflict: 'email,dig_date' });

      // Get cumulative stats for email
      const { data: allRows } = await supabase
        .from('discovery_stats')
        .select('artists_discovered, streak')
        .eq('email', profile.email)
        .order('dig_date', { ascending: true });

      const totalArtists = allRows?.reduce((s, r) => s + r.artists_discovered, 0) ?? uniqueArtists.size;
      const digNumber = allRows?.length ?? 1;

      // Send email
      await sendEmail(
        profile.email,
        (profile.display_name as string) ?? 'friend',
        orbits,
        { digNumber, streak, totalArtists },
      );

      processed++;
      console.log(`Done: ${profile.email} - ${orbits.length} playlists, ${totalTracks} tracks`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`${profile.email}: ${msg}`);
      console.error(`Failed for ${profile.email}:`, msg);
    }
  }

  return new Response(JSON.stringify({ processed, skipped: profiles.length - eligible.length, errors }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
