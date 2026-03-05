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

// Spotify-recognized genre seeds (subset that Spotify accepts)
const SPOTIFY_GENRE_SEEDS = [
  'acoustic', 'afrobeat', 'alt-rock', 'alternative', 'ambient',
  'blues', 'bossanova', 'british', 'chill', 'classical',
  'club', 'country', 'dance', 'deep-house', 'disco',
  'drum-and-bass', 'dub', 'dubstep', 'edm', 'electro',
  'electronic', 'folk', 'funk', 'garage', 'gospel',
  'groove', 'grunge', 'happy', 'hard-rock', 'hardcore',
  'hip-hop', 'house', 'idm', 'indie', 'indie-pop',
  'industrial', 'j-pop', 'j-rock', 'jazz', 'k-pop',
  'latin', 'metal', 'minimal-techno', 'new-age', 'opera',
  'piano', 'pop', 'punk', 'r-n-b', 'reggae',
  'reggaeton', 'rock', 'romance', 'sad', 'salsa',
  'samba', 'shoe-gaze', 'singer-songwriter', 'ska', 'sleep',
  'soul', 'study', 'synth-pop', 'techno', 'trance',
  'trip-hop', 'world-music',
];

export async function runDiscoveryEngine(
  musicService: MusicService,
  onProgress: (state: EngineState) => void,
): Promise<DiscoveryOrbit[]> {
  const diag: string[] = [];

  const progress: SignalProgress[] = [
    { label: 'Loading your top artists', status: 'pending' },
    { label: 'Analyzing your genres', status: 'pending' },
    { label: 'Discovering new music', status: 'pending' },
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
  // Step 1: Get your top artists
  // ============================
  setStep(0, 'loading');

  let allUserArtists: MusicArtist[] = [];
  const knownNames = new Set<string>();

  for (const range of ['short', 'medium', 'long'] as const) {
    try {
      const artists = await musicService.getTopArtists(range, 50);
      diag.push(`${range}_term artists: ${artists.length}`);
      for (const a of artists) {
        if (!knownNames.has(a.name.toLowerCase())) {
          knownNames.add(a.name.toLowerCase());
          allUserArtists.push(a);
        }
      }
    } catch (e) {
      diag.push(`${range}_term FAILED: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Also get top tracks to know track-level exclusions
  const knownTrackIds = new Set<string>();
  for (const range of ['short', 'medium', 'long'] as const) {
    try {
      const tracks = await musicService.getTopTracks(range, 50);
      for (const t of tracks) {
        knownTrackIds.add(t.id);
        knownNames.add(t.artist.toLowerCase());
      }
    } catch { /* non-critical */ }
  }

  diag.push(`unique known artists: ${knownNames.size}`);
  diag.push(`known track IDs: ${knownTrackIds.size}`);

  if (allUserArtists.length === 0) {
    setStep(0, 'error');
    return fail('No top artists found.');
  }

  setStep(0, 'done', `${allUserArtists.length} artists`);

  // ============================
  // Step 2: Extract and match genres
  // ============================
  setStep(1, 'loading');

  // Get all genres from user's artists
  const userGenres = new Map<string, number>();
  for (const a of allUserArtists) {
    for (const g of (a.genres ?? [])) {
      userGenres.set(g.toLowerCase(), (userGenres.get(g.toLowerCase()) || 0) + 1);
    }
  }

  // Match to Spotify's accepted genre seeds
  const matchedGenres: string[] = [];
  for (const seed of SPOTIFY_GENRE_SEEDS) {
    // Check if any user genre contains or matches this seed
    for (const [userGenre] of userGenres) {
      if (userGenre.includes(seed) || seed.includes(userGenre.replace(/\s+/g, '-'))) {
        if (!matchedGenres.includes(seed)) {
          matchedGenres.push(seed);
        }
        break;
      }
    }
  }

  // Also find genres the user DOESN'T listen to (for wildcard)
  const unusedGenres = SPOTIFY_GENRE_SEEDS.filter(g => !matchedGenres.includes(g));

  diag.push(`user genres: ${Array.from(userGenres.keys()).slice(0, 10).join(', ')}...`);
  diag.push(`matched Spotify seeds: ${matchedGenres.join(', ')}`);
  diag.push(`unused genres available: ${unusedGenres.length}`);

  if (matchedGenres.length === 0) {
    // Fallback: use broad genres
    matchedGenres.push('pop', 'rock', 'hip-hop', 'r-n-b', 'electronic');
    diag.push('using fallback genres');
  }

  setStep(1, 'done', `${matchedGenres.length} genre seeds`);

  // ============================
  // Step 3: Discover new music via Recommendations + Search
  // ============================
  setStep(2, 'loading');

  const isNew = (t: MusicTrack) =>
    !knownTrackIds.has(t.id) && !knownNames.has(t.artist.toLowerCase());

  const allNewTracks: MusicTrack[] = [];

  // Strategy A: Recommendations seeded by genres (multiple batches with different seeds)
  const genreBatches = shuffle(matchedGenres);
  for (let i = 0; i < genreBatches.length && allNewTracks.length < 150; i += 2) {
    const seeds = genreBatches.slice(i, i + 2);
    if (seeds.length === 0) break;
    try {
      const recs = await musicService.getRecommendations({
        seedGenres: seeds,
        limit: 50,
      });
      const newOnes = recs.filter(isNew);
      allNewTracks.push(...newOnes);
      diag.push(`recs [${seeds.join(',')}]: ${recs.length} total, ${newOnes.length} new`);
    } catch (e) {
      diag.push(`recs [${seeds.join(',')}] FAILED: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Strategy B: Search for genre terms to find more variety
  const searchTerms = shuffle(matchedGenres).slice(0, 5);
  for (const term of searchTerms) {
    if (allNewTracks.length >= 150) break;
    try {
      const results = await musicService.searchTracks(`genre:${term}`, 20);
      const newOnes = results.filter(isNew);
      allNewTracks.push(...newOnes);
      diag.push(`search "${term}": ${results.length} total, ${newOnes.length} new`);
    } catch (e) {
      diag.push(`search "${term}" FAILED: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Strategy C: Wildcard — unexplored genre
  const wildcardPick = shuffle(unusedGenres)[0] ?? 'world-music';
  try {
    const recs = await musicService.getRecommendations({
      seedGenres: [wildcardPick],
      limit: 30,
    });
    const newOnes = recs.filter(isNew);
    allNewTracks.push(...newOnes);
    diag.push(`wildcard [${wildcardPick}]: ${recs.length} total, ${newOnes.length} new`);
  } catch (e) {
    diag.push(`wildcard FAILED: ${e instanceof Error ? e.message : e}`);
  }

  diag.push(`total new tracks: ${allNewTracks.length}`);

  const deduped = dedupe(allNewTracks);
  diag.push(`after dedupe: ${deduped.length}`);

  if (deduped.length === 0) {
    setStep(2, 'error');
    return fail('Could not find any new music.');
  }

  setStep(2, 'done', `${deduped.length} new songs found`);

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

  diag.push(`orbits: ${orbits.length}, total tracks: ${orbits.reduce((s, o) => s + o.tracks.length, 0)}`);

  if (orbits.length === 0) {
    setStep(3, 'error');
    return fail('Had tracks but could not fill playlists.');
  }

  setStep(3, 'done', `${orbits.length} playlists`);

  console.log('[vyba] Done:', orbits.length, 'playlists,',
    orbits.reduce((s, o) => s + o.tracks.length, 0), 'tracks');

  onProgress({ orbits, isLoading: false, progress });
  return orbits;
}
