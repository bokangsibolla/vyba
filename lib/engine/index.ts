import { MusicService, MusicTrack, MusicArtist } from '@/lib/music/types';
import { sectionColors, sectionMeta } from '@/lib/tokens';
import {
  DiscoveryOrbit,
  EngineState,
  SignalProgress,
  OrbitId,
  DiscoveredArtist,
} from './types';

const TARGET_PER_ORBIT = 18;

// --- Helpers ---

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

function makeOrbit(
  id: OrbitId,
  tracks: MusicTrack[],
): DiscoveryOrbit {
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

// --- Main engine ---

export async function runDiscoveryEngine(
  musicService: MusicService,
  onProgress: (state: EngineState) => void,
): Promise<DiscoveryOrbit[]> {
  const progress: SignalProgress[] = [
    { label: 'Loading your top artists', status: 'pending' },
    { label: 'Finding artists you don\'t know', status: 'pending' },
    { label: 'Getting their best songs', status: 'pending' },
    { label: 'Building your playlists', status: 'pending' },
  ];

  const emit = (orbits: DiscoveryOrbit[] = []) => {
    onProgress({ orbits, isLoading: true, progress: [...progress] });
  };

  const setStep = (i: number, status: SignalProgress['status'], detail?: string) => {
    progress[i] = { ...progress[i], status, detail };
    emit();
  };

  emit();

  // ============================
  // Step 1: Get your top artists
  // ============================
  setStep(0, 'loading');

  const [shortArtists, mediumArtists, longArtists] = await Promise.all([
    musicService.getTopArtists('short', 50).catch(() => [] as MusicArtist[]),
    musicService.getTopArtists('medium', 50).catch(() => [] as MusicArtist[]),
    musicService.getTopArtists('long', 50).catch(() => [] as MusicArtist[]),
  ]);

  // Build the "known artists" set — just from top artists, no extra scopes needed
  const knownNames = new Set<string>();
  const knownIds = new Set<string>();
  const allUserArtists: MusicArtist[] = [];

  for (const a of [...shortArtists, ...mediumArtists, ...longArtists]) {
    if (!knownIds.has(a.id)) {
      knownIds.add(a.id);
      knownNames.add(a.name.toLowerCase());
      allUserArtists.push(a);
    }
  }

  if (allUserArtists.length === 0) {
    const msg = 'No top artists found. Listen to more music on Spotify first.';
    setStep(0, 'error', msg);
    onProgress({ orbits: [], isLoading: false, progress, error: msg });
    return [];
  }

  setStep(0, 'done', `${allUserArtists.length} artists`);

  // ============================
  // Step 2: Find related artists you DON'T listen to
  // ============================
  setStep(1, 'loading');

  const newArtists: MusicArtist[] = [];
  const newArtistIds = new Set<string>();

  // Get related artists for up to 10 of the user's top artists
  for (const artist of shuffle(allUserArtists).slice(0, 10)) {
    try {
      const related = await musicService.getRelatedArtists(artist.id);
      for (const r of related) {
        if (!knownNames.has(r.name.toLowerCase()) && !newArtistIds.has(r.id)) {
          newArtistIds.add(r.id);
          newArtists.push(r);
        }
      }
    } catch { /* skip */ }
  }

  if (newArtists.length === 0) {
    const msg = 'Could not find new artists. Try again later.';
    setStep(1, 'error', msg);
    onProgress({ orbits: [], isLoading: false, progress, error: msg });
    return [];
  }

  setStep(1, 'done', `${newArtists.length} new artists`);

  // ============================
  // Step 3: Get top tracks from new artists
  // ============================
  setStep(2, 'loading');

  const allNewTracks: MusicTrack[] = [];

  for (const artist of shuffle(newArtists).slice(0, 40)) {
    try {
      const tracks = await musicService.getArtistTopTracks(artist.id);
      // Double-check: only keep tracks by artists NOT in user's top artists
      const genuinelyNew = tracks.filter(t => !knownNames.has(t.artist.toLowerCase()));
      allNewTracks.push(...genuinelyNew.slice(0, 3));
    } catch { /* skip */ }
  }

  const deduped = dedupe(allNewTracks);

  setStep(2, 'done', `${deduped.length} new songs`);

  if (deduped.length === 0) {
    const msg = 'Found new artists but could not get their tracks.';
    setStep(2, 'error', msg);
    onProgress({ orbits: [], isLoading: false, progress, error: msg });
    return [];
  }

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
    if (tracks.length >= 5) {
      orbits.push(makeOrbit(id, tracks));
    }
  }

  setStep(3, 'done', `${orbits.length} playlists, ${orbits.reduce((s, o) => s + o.tracks.length, 0)} songs`);

  console.log('[vyba] Done:', orbits.length, 'playlists,',
    orbits.reduce((s, o) => s + o.tracks.length, 0), 'total tracks from',
    newArtists.length, 'new artists');

  onProgress({ orbits, isLoading: false, progress });
  return orbits;
}
