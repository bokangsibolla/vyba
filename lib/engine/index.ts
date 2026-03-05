import { MusicService, MusicTrack, MusicArtist } from '@/lib/music/types';
import { sectionColors, sectionMeta } from '@/lib/tokens';
import {
  DiscoveryOrbit,
  EngineState,
  SignalProgress,
  OrbitId,
  DiscoveredArtist,
} from './types';
import { detectTasteFrontier, getEmergingGenres } from './frontier';

const MIN_TRACKS_PER_ORBIT = 15;

// --- Helpers ---

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Strict dedup: by track ID, then max one track per artist */
function dedupe(tracks: MusicTrack[]): MusicTrack[] {
  const seenIds = new Set<string>();
  const seenArtists = new Set<string>();
  return tracks.filter((t) => {
    if (seenIds.has(t.id)) return false;
    const artistKey = t.artist?.toLowerCase() ?? t.id;
    if (seenArtists.has(artistKey)) return false;
    seenIds.add(t.id);
    seenArtists.add(artistKey);
    return true;
  });
}

function makeOrbit(
  id: OrbitId,
  tracks: MusicTrack[],
  artists: DiscoveredArtist[],
  confidence: number,
): DiscoveryOrbit {
  const meta = sectionMeta[id as keyof typeof sectionMeta];
  const color = sectionColors[id as keyof typeof sectionColors];
  return {
    id,
    label: meta?.label ?? id,
    description: meta?.tagline ?? '',
    color: { name: id, from: color?.bg ?? '#F0F0F0', to: color?.accent ?? '#888888' },
    tracks,
    artists,
    confidence: Math.min(1, Math.max(0, confidence)),
    status: tracks.length > 0 ? 'ready' : 'error',
  };
}

function initialProgress(): SignalProgress[] {
  return [
    { label: 'Your listening history', status: 'pending' },
    { label: 'Building exclusion list', status: 'pending' },
    { label: 'Finding new artists', status: 'pending' },
    { label: 'Collecting candidates', status: 'pending' },
    { label: 'Verifying against your library', status: 'pending' },
    { label: 'Building playlists', status: 'pending' },
  ];
}

function updateProgress(
  progress: SignalProgress[],
  index: number,
  status: SignalProgress['status'],
  detail?: string,
): SignalProgress[] {
  return progress.map((p, i) =>
    i === index ? { ...p, status, detail } : p,
  );
}

// --- Main engine ---

export async function runDiscoveryEngine(
  musicService: MusicService,
  onProgress: (state: EngineState) => void,
): Promise<DiscoveryOrbit[]> {
  let progress = initialProgress();

  const emit = (orbits: DiscoveryOrbit[] = []) => {
    onProgress({ orbits, isLoading: true, progress: [...progress] });
  };

  emit();

  // ========================================
  // Phase 1: Load the user's listening data
  // ========================================
  progress = updateProgress(progress, 0, 'loading');
  emit();

  let allArtists: { shortTerm: MusicArtist[]; mediumTerm: MusicArtist[]; longTerm: MusicArtist[] };
  let userTopTrackIds: Set<string>;

  try {
    const [shortTracks, mediumTracks, longTracks, artists] = await Promise.all([
      musicService.getTopTracks('short', 50).catch(() => [] as MusicTrack[]),
      musicService.getTopTracks('medium', 50).catch(() => [] as MusicTrack[]),
      musicService.getTopTracks('long', 50).catch(() => [] as MusicTrack[]),
      musicService.getTopArtistsAllRanges().catch(() => ({
        shortTerm: [] as MusicArtist[],
        mediumTerm: [] as MusicArtist[],
        longTerm: [] as MusicArtist[],
      })),
    ]);

    const allTracks = [...shortTracks, ...mediumTracks, ...longTracks];
    userTopTrackIds = new Set(allTracks.map(t => t.id));
    allArtists = artists;

    console.log('[vyba] Top tracks:', userTopTrackIds.size, 'Top artists:', new Set([
      ...artists.shortTerm.map(a => a.id),
      ...artists.mediumTerm.map(a => a.id),
      ...artists.longTerm.map(a => a.id),
    ]).size);

    progress = updateProgress(progress, 0, 'done', `${userTopTrackIds.size} tracks loaded`);
    emit();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load listening data';
    progress = updateProgress(progress, 0, 'error', message);
    onProgress({ orbits: [], isLoading: false, progress, error: message });
    return [];
  }

  // ========================================
  // Phase 2: Build COMPREHENSIVE exclusion list
  // ========================================
  progress = updateProgress(progress, 1, 'loading');
  emit();

  const knownTrackIds = new Set<string>(userTopTrackIds);
  const knownArtistIds = new Set<string>();
  const knownArtistNames = new Set<string>();

  for (const a of [...allArtists.shortTerm, ...allArtists.mediumTerm, ...allArtists.longTerm]) {
    knownArtistIds.add(a.id);
    knownArtistNames.add(a.name.toLowerCase());
  }

  // Fetch the FULL library (saved tracks, followed artists, recent plays)
  try {
    const library = await musicService.getLibraryExclusions();
    for (const id of library.trackIds) knownTrackIds.add(id);
    for (const id of library.artistIds) knownArtistIds.add(id);
    for (const name of library.artistNames) knownArtistNames.add(name);

    progress = updateProgress(progress, 1, 'done',
      `${knownTrackIds.size} tracks, ${knownArtistNames.size} artists excluded`);
    emit();
  } catch {
    progress = updateProgress(progress, 1, 'done', 'Using top tracks only');
    emit();
  }

  console.log(`[vyba] Exclusion list: ${knownTrackIds.size} tracks, ${knownArtistNames.size} artists`);

  // Artist-only filter (used before library verification)
  function isFromNewArtist(t: MusicTrack): boolean {
    return !knownArtistNames.has(t.artist.toLowerCase());
  }

  // ========================================
  // Phase 3: Discover NEW artists via Related Artists
  // ========================================
  progress = updateProgress(progress, 2, 'loading');
  emit();

  const newArtistPool: MusicArtist[] = [];
  const newArtistIds = new Set<string>();

  const seedArtists = shuffle([
    ...allArtists.shortTerm,
    ...allArtists.mediumTerm,
    ...allArtists.longTerm,
  ]);
  const seenSeedIds = new Set<string>();
  const uniqueSeeds = seedArtists.filter(a => {
    if (seenSeedIds.has(a.id)) return false;
    seenSeedIds.add(a.id);
    return true;
  });

  // 1-hop: related artists for up to 8 of user's artists
  for (const artist of uniqueSeeds.slice(0, 8)) {
    try {
      const related = await musicService.getRelatedArtists(artist.id);
      for (const r of related) {
        if (!knownArtistIds.has(r.id) && !knownArtistNames.has(r.name.toLowerCase()) && !newArtistIds.has(r.id)) {
          newArtistIds.add(r.id);
          newArtistPool.push(r);
        }
      }
    } catch { /* skip */ }
  }

  console.log(`[vyba] Found ${newArtistPool.length} new related artists (1-hop)`);

  // 2-hop if needed
  if (newArtistPool.length < 30) {
    for (const artist of shuffle(newArtistPool).slice(0, 4)) {
      try {
        const related2 = await musicService.getRelatedArtists(artist.id);
        for (const r of related2) {
          if (!knownArtistIds.has(r.id) && !knownArtistNames.has(r.name.toLowerCase()) && !newArtistIds.has(r.id)) {
            newArtistIds.add(r.id);
            newArtistPool.push(r);
          }
        }
      } catch { /* skip */ }
    }
    console.log(`[vyba] After 2-hop: ${newArtistPool.length} new artists`);
  }

  progress = updateProgress(progress, 2, 'done', `${newArtistPool.length} new artists found`);
  emit();

  // ========================================
  // Phase 4: Collect ALL candidate tracks
  // We collect everything first, then verify in Phase 5
  // ========================================
  progress = updateProgress(progress, 3, 'loading');
  emit();

  // Each orbit gets its own candidate bucket
  const candidateBuckets: Record<string, MusicTrack[]> = {
    roots: [],
    edges: [],
    crowd: [],
    blindspot: [],
    deepwork: [],
    wildcard: [],
  };

  const shuffledNewArtists = shuffle(newArtistPool);
  const poolSize = Math.ceil(shuffledNewArtists.length / 4);
  const rootsPool = shuffledNewArtists.slice(0, poolSize);
  const edgesPool = shuffledNewArtists.slice(poolSize, poolSize * 2);
  const crowdPool = shuffledNewArtists.slice(poolSize * 2, poolSize * 3);
  const blindspotPool = shuffledNewArtists.slice(poolSize * 3);

  /** Collect candidate tracks from a pool of new artists */
  async function collectFromPool(pool: MusicArtist[], target: number): Promise<MusicTrack[]> {
    const tracks: MusicTrack[] = [];

    // Strategy A: Get top tracks from new artists
    for (const artist of pool.slice(0, 6)) {
      if (tracks.length >= target) break;
      try {
        const topTracks = await musicService.getArtistTopTracks(artist.id);
        tracks.push(...topTracks.filter(isFromNewArtist).slice(0, 3));
      } catch { /* skip */ }
    }

    // Strategy B: Recommendations seeded from new artists
    if (tracks.length < target && pool.length > 0) {
      try {
        const recs = await musicService.getRecommendations({
          seedArtistIds: pool.slice(0, 5).map(a => a.id),
          limit: 50,
        });
        tracks.push(...recs.filter(isFromNewArtist));
      } catch { /* skip */ }
    }

    return tracks;
  }

  // Collect for ROOTS
  candidateBuckets.roots = await collectFromPool(rootsPool, 30);

  // Collect for EDGES
  candidateBuckets.edges = await collectFromPool(edgesPool, 30);

  // Collect for CROWD
  candidateBuckets.crowd = await collectFromPool(crowdPool, 30);
  // Add genre-based recommendations for emerging genres
  const frontier = detectTasteFrontier(
    allArtists.shortTerm, allArtists.mediumTerm, allArtists.longTerm,
  );
  const emergingGenres = getEmergingGenres(frontier);
  if (emergingGenres.length > 0) {
    try {
      const genreRecs = await musicService.getRecommendations({
        seedGenres: shuffle(emergingGenres).slice(0, 5),
        limit: 30,
      });
      candidateBuckets.crowd.push(...genreRecs.filter(isFromNewArtist));
    } catch { /* skip */ }
  }

  // Collect for BLINDSPOT (3-hop: related of related of related)
  if (blindspotPool.length > 0) {
    for (const artist of shuffle(blindspotPool).slice(0, 4)) {
      if (candidateBuckets.blindspot.length >= 30) break;
      try {
        const farRelated = await musicService.getRelatedArtists(artist.id);
        const genuinelyNewArtists = farRelated.filter(r =>
          !knownArtistIds.has(r.id) && !knownArtistNames.has(r.name.toLowerCase())
        );
        for (const far of shuffle(genuinelyNewArtists).slice(0, 3)) {
          if (candidateBuckets.blindspot.length >= 30) break;
          const topTracks = await musicService.getArtistTopTracks(far.id);
          candidateBuckets.blindspot.push(...topTracks.filter(isFromNewArtist).slice(0, 3));
        }
      } catch { /* skip */ }
    }
    // Fallback recommendations
    if (candidateBuckets.blindspot.length < MIN_TRACKS_PER_ORBIT) {
      try {
        const recs = await musicService.getRecommendations({
          seedArtistIds: shuffle(blindspotPool).slice(0, 5).map(a => a.id),
          limit: 30,
        });
        candidateBuckets.blindspot.push(...recs.filter(isFromNewArtist));
      } catch { /* skip */ }
    }
  }

  // Collect for DEEP WORK
  const ambientNewArtists = newArtistPool.filter(a =>
    a.genres.some(g => /ambient|chill|lo-?fi|instrumental|electronic|study|piano|classical/i.test(g))
  );
  try {
    const seedArtistIdsForDeep = ambientNewArtists.length > 0
      ? shuffle(ambientNewArtists).slice(0, 2).map(a => a.id)
      : [];
    const recs = await musicService.getRecommendations({
      seedArtistIds: seedArtistIdsForDeep,
      seedGenres: shuffle(['ambient', 'chill', 'study', 'piano', 'electronic']).slice(0, 5 - seedArtistIdsForDeep.length),
      limit: 40,
    });
    candidateBuckets.deepwork.push(...recs.filter(isFromNewArtist));
  } catch { /* skip */ }
  if (candidateBuckets.deepwork.length < MIN_TRACKS_PER_ORBIT) {
    for (const q of ['lo-fi beats instrumental', 'ambient focus music']) {
      if (candidateBuckets.deepwork.length >= 30) break;
      try {
        const results = await musicService.searchTracks(q, 20);
        candidateBuckets.deepwork.push(...results.filter(isFromNewArtist));
      } catch { /* skip */ }
    }
  }

  // Collect for WILDCARD
  const userGenreSet = new Set(
    [...allArtists.shortTerm, ...allArtists.mediumTerm, ...allArtists.longTerm]
      .flatMap(a => a.genres)
      .map(g => g.toLowerCase()),
  );
  const wildcardGenres = [
    'afrobeats', 'bossa nova', 'k-pop', 'amapiano', 'reggaeton',
    'shoegaze', 'city pop', 'dub', 'highlife', 'tropicalia',
    'cumbia', 'grime', 'baile funk', 'dancehall', 'ethio-jazz',
  ];
  const unexplored = wildcardGenres.filter(g => !userGenreSet.has(g));
  const wildcardPick = unexplored[Math.floor(Math.random() * unexplored.length)] ?? 'world music';

  try {
    const recs = await musicService.getRecommendations({
      seedGenres: [wildcardPick],
      limit: 30,
    });
    candidateBuckets.wildcard.push(...recs.filter(isFromNewArtist));
  } catch { /* skip */ }
  if (candidateBuckets.wildcard.length < MIN_TRACKS_PER_ORBIT) {
    try {
      const results = await musicService.searchTracks(`best ${wildcardPick} songs`, 20);
      candidateBuckets.wildcard.push(...results.filter(isFromNewArtist));
    } catch { /* skip */ }
  }

  const totalCandidates = Object.values(candidateBuckets).reduce((s, b) => s + b.length, 0);
  progress = updateProgress(progress, 3, 'done', `${totalCandidates} candidates collected`);
  emit();

  // ========================================
  // Phase 5: THE NUCLEAR VERIFICATION STEP
  // Check ALL candidates against Spotify's actual library via /me/tracks/contains
  // ========================================
  progress = updateProgress(progress, 4, 'loading');
  emit();

  // Gather all unique candidate track IDs across all buckets
  const allCandidateIds = new Set<string>();
  for (const bucket of Object.values(candidateBuckets)) {
    for (const t of bucket) {
      allCandidateIds.add(t.id);
    }
  }

  // Batch-verify against Spotify's library
  const inLibrary = await musicService.checkTracksInLibrary(Array.from(allCandidateIds));
  console.log(`[vyba] Library verification: ${inLibrary.size}/${allCandidateIds.size} tracks already in library`);

  // Add verified library tracks to known set
  for (const id of inLibrary) knownTrackIds.add(id);

  // Full verification filter: not in library (verified) AND not from known artist
  function isVerifiedNew(t: MusicTrack): boolean {
    if (knownTrackIds.has(t.id)) return false;
    if (inLibrary.has(t.id)) return false;
    if (knownArtistNames.has(t.artist.toLowerCase())) return false;
    return true;
  }

  progress = updateProgress(progress, 4, 'done',
    `${inLibrary.size} tracks filtered out — only verified new tracks remain`);
  emit();

  // ========================================
  // Phase 6: Build orbits from VERIFIED new tracks only
  // ========================================
  progress = updateProgress(progress, 5, 'loading');
  emit();

  const orbits: DiscoveryOrbit[] = [];
  const usedIds = new Set<string>();

  function claimAndFilter(tracks: MusicTrack[]): MusicTrack[] {
    const result: MusicTrack[] = [];
    for (const t of tracks) {
      if (!usedIds.has(t.id) && isVerifiedNew(t)) {
        usedIds.add(t.id);
        result.push(t);
      }
    }
    return result;
  }

  // ROOTS
  {
    const tracks = dedupe(claimAndFilter(candidateBuckets.roots)).slice(0, 20);
    if (tracks.length > 0) {
      orbits.push(makeOrbit('roots', tracks, [], Math.min(1, tracks.length / 15)));
    }
  }

  // EDGES
  {
    const tracks = dedupe(claimAndFilter(candidateBuckets.edges)).slice(0, 20);
    if (tracks.length > 0) {
      orbits.push(makeOrbit('edges', tracks, [], Math.min(1, tracks.length / 15)));
    }
  }

  // CROWD
  {
    const tracks = dedupe(claimAndFilter(candidateBuckets.crowd)).slice(0, 20);
    if (tracks.length > 0) {
      orbits.push(makeOrbit('crowd', tracks, [], 0.7));
    }
  }

  // BLINDSPOT
  {
    const tracks = dedupe(claimAndFilter(candidateBuckets.blindspot)).slice(0, 20);
    if (tracks.length > 0) {
      orbits.push(makeOrbit('blindspot', tracks, [], 0.5));
    }
  }

  // DEEP WORK
  {
    const tracks = dedupe(claimAndFilter(candidateBuckets.deepwork)).slice(0, 20);
    if (tracks.length > 0) {
      orbits.push(makeOrbit('deepwork', tracks, [], 0.5));
    }
  }

  // WILDCARD
  {
    const tracks = dedupe(claimAndFilter(candidateBuckets.wildcard)).slice(0, 20);
    if (tracks.length > 0) {
      const orbit = makeOrbit('wildcard', tracks, [], 0.4);
      orbit.description = `Today's left turn: ${wildcardPick}`;
      orbits.push(orbit);
    }
  }

  // Graceful degradation
  if (orbits.length === 0 && newArtistPool.length > 0) {
    let tracks: MusicTrack[] = [];
    for (const artist of shuffle(newArtistPool).slice(0, 10)) {
      try {
        const topTracks = await musicService.getArtistTopTracks(artist.id);
        tracks.push(...topTracks.filter(isVerifiedNew));
      } catch { /* skip */ }
      if (tracks.length >= 20) break;
    }
    tracks = dedupe(claimAndFilter(tracks)).slice(0, 20);
    if (tracks.length > 0) {
      orbits.push(makeOrbit('edges', tracks, [], 0.3));
    }
  }

  progress = updateProgress(progress, 5, 'done', `${orbits.length} playlists built`);

  console.log('[vyba] Built', orbits.length, 'orbits with',
    orbits.reduce((s, o) => s + o.tracks.length, 0), 'total VERIFIED new tracks');

  onProgress({ orbits, isLoading: false, progress });
  return orbits;
}
