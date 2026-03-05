import { MusicService, MusicTrack, MusicArtist } from '@/lib/music/types';
import { sectionColors, sectionMeta } from '@/lib/tokens';
import {
  DiscoveryOrbit,
  EngineState,
  SignalProgress,
  OrbitId,
} from './types';

const TARGET_PER_ORBIT = 18;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dedupe(tracks: MusicTrack[]): MusicTrack[] {
  const seenIds = new Set<string>();
  const seenArtists = new Set<string>();
  return tracks.filter((t) => {
    if (seenIds.has(t.id)) return false;
    const key = t.artist.toLowerCase();
    if (seenArtists.has(key)) return false;
    seenIds.add(t.id);
    seenArtists.add(key);
    return true;
  });
}

function makeOrbit(id: OrbitId, tracks: MusicTrack[]): DiscoveryOrbit {
  const meta = sectionMeta[id as keyof typeof sectionMeta];
  const color = sectionColors[id as keyof typeof sectionColors];
  return {
    id,
    label: meta?.label ?? id,
    description: meta?.tagline ?? '',
    color: { name: id, from: color?.bg ?? '#F0F0F0', to: color?.accent ?? '#888888' },
    tracks,
    artists: [],
    confidence: Math.min(1, tracks.length / 15),
    status: tracks.length > 0 ? 'ready' : 'error',
  };
}

export async function runDiscoveryEngine(
  musicService: MusicService,
  onProgress: (state: EngineState) => void,
): Promise<DiscoveryOrbit[]> {
  const diag: string[] = [];

  const progress: SignalProgress[] = [
    { label: 'Loading your music taste', status: 'pending' },
    { label: 'Building search queries', status: 'pending' },
    { label: 'Searching for new music', status: 'pending' },
    { label: 'Building playlists', status: 'pending' },
  ];

  const emit = (orbits: DiscoveryOrbit[] = []) => {
    onProgress({ orbits, isLoading: true, progress: [...progress] });
  };

  const setStep = (i: number, status: SignalProgress['status'], detail?: string) => {
    progress[i] = { ...progress[i], status, detail };
    emit();
  };

  const fail = (msg: string): DiscoveryOrbit[] => {
    const fullMsg = msg + '\n\nDiagnostics:\n' + diag.join('\n');
    onProgress({ orbits: [], isLoading: false, progress, error: fullMsg });
    return [];
  };

  emit();

  // ============================
  // Step 1: Get user's taste profile
  // ============================
  setStep(0, 'loading');

  const knownNames = new Set<string>();
  const knownTrackIds = new Set<string>();
  const allGenres: string[] = [];

  for (const range of ['short', 'medium', 'long'] as const) {
    try {
      const artists = await musicService.getTopArtists(range, 50);
      diag.push(`${range} artists: ${artists.length}`);
      for (const a of artists) {
        knownNames.add(a.name.toLowerCase());
        for (const g of (a.genres ?? [])) {
          allGenres.push(g.toLowerCase());
        }
      }
    } catch (e) {
      diag.push(`${range} artists FAILED: ${e instanceof Error ? e.message : e}`);
    }

    try {
      const tracks = await musicService.getTopTracks(range, 50);
      for (const t of tracks) {
        knownTrackIds.add(t.id);
        knownNames.add(t.artist.toLowerCase());
      }
    } catch { /* non-critical */ }
  }

  diag.push(`known artists: ${knownNames.size}, known tracks: ${knownTrackIds.size}`);

  // Count genre frequency
  const genreCounts = new Map<string, number>();
  for (const g of allGenres) {
    genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
  }
  const topGenres = Array.from(genreCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([g]) => g)
    .slice(0, 15);

  diag.push(`top genres: ${topGenres.slice(0, 8).join(', ')}`);

  if (knownNames.size === 0) {
    setStep(0, 'error');
    return fail('No listening data found.');
  }

  setStep(0, 'done', `${knownNames.size} artists, ${topGenres.length} genres`);

  // ============================
  // Step 2: Build search queries from genres
  // ============================
  setStep(1, 'loading');

  // Create varied search queries from the user's genres
  const searchQueries: { query: string; label: string }[] = [];

  // From top genres — search for tracks in those genres
  for (const genre of topGenres.slice(0, 8)) {
    searchQueries.push({ query: genre, label: genre });
  }

  // Add discovery-oriented queries
  for (const genre of shuffle(topGenres).slice(0, 4)) {
    searchQueries.push({ query: `${genre} underground`, label: `${genre} underground` });
    searchQueries.push({ query: `${genre} new`, label: `${genre} new` });
  }

  // Wildcard: genres the user doesn't listen to
  const wildcardGenres = [
    'afrobeats', 'bossa nova', 'city pop', 'amapiano', 'shoegaze',
    'dub', 'highlife', 'cumbia', 'grime', 'ethio jazz',
    'tropicalia', 'dancehall', 'baile funk', 'post punk', 'dream pop',
  ].filter(g => !topGenres.some(tg => tg.includes(g) || g.includes(tg)));
  const wildcardPick = shuffle(wildcardGenres)[0] ?? 'world music';
  searchQueries.push({ query: wildcardPick, label: `wildcard: ${wildcardPick}` });

  // Ambient/focus queries
  searchQueries.push({ query: 'lo-fi chill beats', label: 'focus' });
  searchQueries.push({ query: 'ambient instrumental', label: 'ambient' });

  diag.push(`search queries: ${searchQueries.length}`);
  setStep(1, 'done', `${searchQueries.length} search queries`);

  // ============================
  // Step 3: Search and collect new tracks
  // ============================
  setStep(2, 'loading');

  const isNew = (t: MusicTrack) =>
    !knownTrackIds.has(t.id) && !knownNames.has(t.artist.toLowerCase());

  const allNewTracks: MusicTrack[] = [];
  let searchSuccesses = 0;
  let searchFailures = 0;

  for (const { query, label } of searchQueries) {
    try {
      const results = await musicService.searchTracks(query, 30);
      const newOnes = results.filter(isNew);
      allNewTracks.push(...newOnes);
      searchSuccesses++;
      if (newOnes.length > 0) {
        diag.push(`"${label}": ${results.length} results, ${newOnes.length} new`);
      }
    } catch (e) {
      searchFailures++;
      diag.push(`"${label}" FAILED: ${e instanceof Error ? e.message : e}`);
    }
  }

  diag.push(`searches: ${searchSuccesses} ok, ${searchFailures} failed`);
  diag.push(`total new tracks: ${allNewTracks.length}`);

  const deduped = dedupe(allNewTracks);
  diag.push(`after dedupe: ${deduped.length}`);

  if (deduped.length === 0) {
    setStep(2, 'error');
    return fail('Searches ran but found no new music after filtering.');
  }

  setStep(2, 'done', `${deduped.length} new songs`);

  // ============================
  // Step 4: Split into playlists
  // ============================
  setStep(3, 'loading');

  const shuffled = shuffle(deduped);
  const usedIds = new Set<string>();
  const orbits: DiscoveryOrbit[] = [];

  function takeSlice(count: number): MusicTrack[] {
    const slice: MusicTrack[] = [];
    for (const t of shuffled) {
      if (slice.length >= count) break;
      if (!usedIds.has(t.id)) {
        usedIds.add(t.id);
        slice.push(t);
      }
    }
    return slice;
  }

  const orbitIds: OrbitId[] = ['roots', 'edges', 'crowd', 'blindspot', 'deepwork', 'wildcard'];

  for (const id of orbitIds) {
    const tracks = takeSlice(TARGET_PER_ORBIT);
    if (tracks.length >= 3) {
      const orbit = makeOrbit(id, tracks);
      if (id === 'wildcard') {
        orbit.description = `Today's left turn: ${wildcardPick}`;
      }
      orbits.push(orbit);
    }
  }

  if (orbits.length === 0) {
    setStep(3, 'error');
    return fail('Had tracks but not enough to fill playlists.');
  }

  setStep(3, 'done', `${orbits.length} playlists`);

  console.log('[vyba] Done:', orbits.length, 'playlists,',
    orbits.reduce((s, o) => s + o.tracks.length, 0), 'tracks');

  onProgress({ orbits, isLoading: false, progress });
  return orbits;
}
