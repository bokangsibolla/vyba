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
  const diag: string[] = []; // diagnostic log — shown on error

  const progress: SignalProgress[] = [
    { label: 'Loading your top artists', status: 'pending' },
    { label: 'Finding new artists', status: 'pending' },
    { label: 'Getting their best songs', status: 'pending' },
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

  let shortArtists: MusicArtist[] = [];
  let mediumArtists: MusicArtist[] = [];
  let longArtists: MusicArtist[] = [];

  try {
    shortArtists = await musicService.getTopArtists('short', 50);
    diag.push(`short_term artists: ${shortArtists.length}`);
  } catch (e) {
    diag.push(`short_term artists FAILED: ${e instanceof Error ? e.message : e}`);
  }

  try {
    mediumArtists = await musicService.getTopArtists('medium', 50);
    diag.push(`medium_term artists: ${mediumArtists.length}`);
  } catch (e) {
    diag.push(`medium_term artists FAILED: ${e instanceof Error ? e.message : e}`);
  }

  try {
    longArtists = await musicService.getTopArtists('long', 50);
    diag.push(`long_term artists: ${longArtists.length}`);
  } catch (e) {
    diag.push(`long_term artists FAILED: ${e instanceof Error ? e.message : e}`);
  }

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

  diag.push(`unique user artists: ${allUserArtists.length}`);

  if (allUserArtists.length === 0) {
    setStep(0, 'error');
    return fail('No top artists found. Listen to more music on Spotify first.');
  }

  setStep(0, 'done', `${allUserArtists.length} artists`);

  // ============================
  // Step 2: Find related artists
  // ============================
  setStep(1, 'loading');

  const newArtists: MusicArtist[] = [];
  const newArtistIds = new Set<string>();
  const seedSlice = shuffle(allUserArtists).slice(0, 5); // only 5 to avoid rate limits

  for (const artist of seedSlice) {
    try {
      const related = await musicService.getRelatedArtists(artist.id);
      diag.push(`related to "${artist.name}": ${related.length} artists`);
      let added = 0;
      for (const r of related) {
        if (!knownNames.has(r.name.toLowerCase()) && !newArtistIds.has(r.id)) {
          newArtistIds.add(r.id);
          newArtists.push(r);
          added++;
        }
      }
      diag.push(`  → ${added} new (not in your top artists)`);
    } catch (e) {
      diag.push(`related to "${artist.name}" FAILED: ${e instanceof Error ? e.message : e}`);
    }
  }

  diag.push(`total new artists: ${newArtists.length}`);

  if (newArtists.length === 0) {
    setStep(1, 'error');
    return fail('Could not find new artists from related artists.');
  }

  setStep(1, 'done', `${newArtists.length} new artists`);

  // ============================
  // Step 3: Get top tracks
  // ============================
  setStep(2, 'loading');

  const allNewTracks: MusicTrack[] = [];
  const artistSlice = shuffle(newArtists).slice(0, 20); // only 20 to avoid rate limits
  let trackErrors = 0;

  for (const artist of artistSlice) {
    try {
      const tracks = await musicService.getArtistTopTracks(artist.id);
      const genuinelyNew = tracks.filter(t => !knownNames.has(t.artist.toLowerCase()));
      allNewTracks.push(...genuinelyNew.slice(0, 3));
      if (genuinelyNew.length > 0) {
        diag.push(`"${artist.name}": ${genuinelyNew.length} new tracks`);
      }
    } catch (e) {
      trackErrors++;
      diag.push(`"${artist.name}" top tracks FAILED: ${e instanceof Error ? e.message : e}`);
    }
  }

  diag.push(`track fetch errors: ${trackErrors}/${artistSlice.length}`);
  diag.push(`total new tracks before dedupe: ${allNewTracks.length}`);

  const deduped = dedupe(allNewTracks);
  diag.push(`after dedupe: ${deduped.length}`);

  if (deduped.length === 0) {
    setStep(2, 'error');
    return fail('Found new artists but could not get their tracks.');
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
    if (tracks.length >= 3) { // lowered from 5 to 3 minimum
      orbits.push(makeOrbit(id, tracks));
    }
  }

  diag.push(`orbits built: ${orbits.length}`);
  diag.push(`total tracks in playlists: ${orbits.reduce((s, o) => s + o.tracks.length, 0)}`);

  if (orbits.length === 0) {
    setStep(3, 'error');
    return fail('Had tracks but could not build playlists.');
  }

  setStep(3, 'done', `${orbits.length} playlists`);

  console.log('[vyba] Done:', orbits.length, 'playlists');
  onProgress({ orbits, isLoading: false, progress });
  return orbits;
}
