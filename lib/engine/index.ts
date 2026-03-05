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
    { label: 'Discovering new artists', status: 'pending' },
    { label: 'Collecting candidate tracks', status: 'pending' },
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
  let libraryLoaded = false;
  try {
    const library = await musicService.getLibraryExclusions();
    for (const id of library.trackIds) knownTrackIds.add(id);
    for (const id of library.artistIds) knownArtistIds.add(id);
    for (const name of library.artistNames) knownArtistNames.add(name);
    libraryLoaded = library.trackIds.size > 0 || library.artistNames.size > 0;

    progress = updateProgress(progress, 1, 'done',
      `${knownTrackIds.size} tracks, ${knownArtistNames.size} artists excluded`);
    emit();
  } catch {
    progress = updateProgress(progress, 1, 'done', 'Using top tracks only');
    emit();
  }

  console.log(`[vyba] Exclusion list: ${knownTrackIds.size} tracks, ${knownArtistNames.size} artists (library loaded: ${libraryLoaded})`);

  // ========================================
  // Phase 3: Discover NEW artists via multi-hop Related Artists
  // Key insight: go 2-3 hops out so artists are GENUINELY unfamiliar
  // ========================================
  progress = updateProgress(progress, 2, 'loading');
  emit();

  const allUserArtists = shuffle([
    ...allArtists.shortTerm,
    ...allArtists.mediumTerm,
    ...allArtists.longTerm,
  ]);
  const seenSeedIds = new Set<string>();
  const uniqueSeeds = allUserArtists.filter(a => {
    if (seenSeedIds.has(a.id)) return false;
    seenSeedIds.add(a.id);
    return true;
  });

  // 1-hop related artists
  const hop1Artists: MusicArtist[] = [];
  const hop1Ids = new Set<string>();
  for (const artist of uniqueSeeds.slice(0, 8)) {
    try {
      const related = await musicService.getRelatedArtists(artist.id);
      for (const r of related) {
        if (!knownArtistIds.has(r.id) && !knownArtistNames.has(r.name.toLowerCase()) && !hop1Ids.has(r.id)) {
          hop1Ids.add(r.id);
          hop1Artists.push(r);
        }
      }
    } catch { /* skip */ }
  }
  console.log(`[vyba] 1-hop new artists: ${hop1Artists.length}`);

  // 2-hop related artists (related of related — further from user)
  const hop2Artists: MusicArtist[] = [];
  const hop2Ids = new Set<string>();
  for (const artist of shuffle(hop1Artists).slice(0, 6)) {
    try {
      const related = await musicService.getRelatedArtists(artist.id);
      for (const r of related) {
        if (!knownArtistIds.has(r.id) && !knownArtistNames.has(r.name.toLowerCase())
            && !hop1Ids.has(r.id) && !hop2Ids.has(r.id)) {
          hop2Ids.add(r.id);
          hop2Artists.push(r);
        }
      }
    } catch { /* skip */ }
  }
  console.log(`[vyba] 2-hop new artists: ${hop2Artists.length}`);

  // 3-hop (related of related of related — very far from user)
  const hop3Artists: MusicArtist[] = [];
  const hop3Ids = new Set<string>();
  for (const artist of shuffle(hop2Artists).slice(0, 4)) {
    try {
      const related = await musicService.getRelatedArtists(artist.id);
      for (const r of related) {
        if (!knownArtistIds.has(r.id) && !knownArtistNames.has(r.name.toLowerCase())
            && !hop1Ids.has(r.id) && !hop2Ids.has(r.id) && !hop3Ids.has(r.id)) {
          hop3Ids.add(r.id);
          hop3Artists.push(r);
        }
      }
    } catch { /* skip */ }
  }
  console.log(`[vyba] 3-hop new artists: ${hop3Artists.length}`);

  const totalNewArtists = hop1Artists.length + hop2Artists.length + hop3Artists.length;
  progress = updateProgress(progress, 2, 'done', `${totalNewArtists} new artists across 3 hops`);
  emit();

  // ========================================
  // Phase 4: Collect candidate tracks from discovered artists
  // IMPORTANT: We use Artist Top Tracks, NOT Recommendations API
  // (Recommendations has familiarity bias — returns songs user likely knows)
  // ========================================
  progress = updateProgress(progress, 3, 'loading');
  emit();

  /** Get top tracks from a list of artists */
  async function getTracksFromArtists(artists: MusicArtist[], maxPerArtist: number, maxTotal: number): Promise<MusicTrack[]> {
    const tracks: MusicTrack[] = [];
    for (const artist of artists) {
      if (tracks.length >= maxTotal) break;
      try {
        const topTracks = await musicService.getArtistTopTracks(artist.id);
        // Only take tracks from artists NOT in our known set
        const newTracks = topTracks.filter(t => !knownArtistNames.has(t.artist.toLowerCase()));
        tracks.push(...newTracks.slice(0, maxPerArtist));
      } catch { /* skip */ }
    }
    return tracks;
  }

  // Collect candidates per orbit bucket
  const candidateBuckets: Record<string, MusicTrack[]> = {
    roots: [],
    edges: [],
    crowd: [],
    blindspot: [],
    deepwork: [],
    wildcard: [],
  };

  // ROOTS: 2-hop artists (connected to taste but unfamiliar)
  candidateBuckets.roots = await getTracksFromArtists(
    shuffle(hop2Artists).slice(0, 10), 4, 40
  );

  // EDGES: 1-hop artists (closest new artists — fans of your music also love these)
  candidateBuckets.edges = await getTracksFromArtists(
    shuffle(hop1Artists).slice(0, 10), 4, 40
  );

  // CROWD: Mix of 1-hop and 2-hop + genre-based recommendations for emerging genres
  candidateBuckets.crowd = await getTracksFromArtists(
    shuffle([...hop1Artists.slice(0, 5), ...hop2Artists.slice(0, 5)]), 3, 30
  );
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
      candidateBuckets.crowd.push(...genreRecs.filter(t => !knownArtistNames.has(t.artist.toLowerCase())));
    } catch { /* skip */ }
  }

  // BLINDSPOT: 3-hop artists (very far from user's taste)
  candidateBuckets.blindspot = await getTracksFromArtists(
    shuffle(hop3Artists).slice(0, 10), 4, 40
  );
  // Fallback if not enough 3-hop artists: use remaining 2-hop
  if (candidateBuckets.blindspot.length < MIN_TRACKS_PER_ORBIT) {
    const more = await getTracksFromArtists(
      shuffle(hop2Artists).slice(10, 20), 3, 30
    );
    candidateBuckets.blindspot.push(...more);
  }

  // DEEP WORK: ambient/instrumental from new artists with matching genres
  const ambientArtists = [...hop1Artists, ...hop2Artists].filter(a =>
    a.genres.some(g => /ambient|chill|lo-?fi|instrumental|electronic|study|piano|classical/i.test(g))
  );
  if (ambientArtists.length > 0) {
    candidateBuckets.deepwork = await getTracksFromArtists(
      shuffle(ambientArtists).slice(0, 10), 4, 40
    );
  }
  // Fallback: genre-based search
  if (candidateBuckets.deepwork.length < MIN_TRACKS_PER_ORBIT) {
    try {
      const recs = await musicService.getRecommendations({
        seedGenres: shuffle(['ambient', 'chill', 'study', 'piano', 'electronic']).slice(0, 5),
        limit: 40,
      });
      candidateBuckets.deepwork.push(...recs.filter(t => !knownArtistNames.has(t.artist.toLowerCase())));
    } catch { /* skip */ }
  }
  if (candidateBuckets.deepwork.length < MIN_TRACKS_PER_ORBIT) {
    for (const q of ['lo-fi beats instrumental', 'ambient focus music', 'study piano chill']) {
      if (candidateBuckets.deepwork.length >= 30) break;
      try {
        const results = await musicService.searchTracks(q, 20);
        candidateBuckets.deepwork.push(...results.filter(t => !knownArtistNames.has(t.artist.toLowerCase())));
      } catch { /* skip */ }
    }
  }

  // WILDCARD: completely unexplored genre
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
    const results = await musicService.searchTracks(`best ${wildcardPick} 2024`, 30);
    candidateBuckets.wildcard.push(...results.filter(t => !knownArtistNames.has(t.artist.toLowerCase())));
  } catch { /* skip */ }
  if (candidateBuckets.wildcard.length < MIN_TRACKS_PER_ORBIT) {
    try {
      const recs = await musicService.getRecommendations({
        seedGenres: [wildcardPick],
        limit: 30,
      });
      candidateBuckets.wildcard.push(...recs.filter(t => !knownArtistNames.has(t.artist.toLowerCase())));
    } catch { /* skip */ }
  }

  const totalCandidates = Object.values(candidateBuckets).reduce((s, b) => s + b.length, 0);
  progress = updateProgress(progress, 3, 'done', `${totalCandidates} candidates collected`);
  emit();

  // ========================================
  // Phase 5: VERIFY ALL candidates against Spotify library
  // This is the definitive check — /me/tracks/contains
  // ========================================
  progress = updateProgress(progress, 4, 'loading');
  emit();

  const allCandidateIds = new Set<string>();
  for (const bucket of Object.values(candidateBuckets)) {
    for (const t of bucket) allCandidateIds.add(t.id);
  }

  let inLibrary = new Set<string>();
  try {
    inLibrary = await musicService.checkTracksInLibrary(Array.from(allCandidateIds));
    console.log(`[vyba] Library verification: ${inLibrary.size}/${allCandidateIds.size} tracks already in library`);
  } catch {
    console.log('[vyba] Library verification failed, continuing with artist-name filter only');
  }

  for (const id of inLibrary) knownTrackIds.add(id);

  function isVerifiedNew(t: MusicTrack): boolean {
    if (knownTrackIds.has(t.id)) return false;
    if (inLibrary.has(t.id)) return false;
    if (knownArtistNames.has(t.artist.toLowerCase())) return false;
    return true;
  }

  progress = updateProgress(progress, 4, 'done',
    `${inLibrary.size} tracks filtered — only verified new remain`);
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

  // Build each orbit
  const orbitConfigs: { id: OrbitId; bucket: string; confidence: number }[] = [
    { id: 'roots', bucket: 'roots', confidence: 0.9 },
    { id: 'edges', bucket: 'edges', confidence: 0.9 },
    { id: 'crowd', bucket: 'crowd', confidence: 0.7 },
    { id: 'blindspot', bucket: 'blindspot', confidence: 0.5 },
    { id: 'deepwork', bucket: 'deepwork', confidence: 0.5 },
    { id: 'wildcard', bucket: 'wildcard', confidence: 0.4 },
  ];

  for (const cfg of orbitConfigs) {
    const tracks = dedupe(claimAndFilter(candidateBuckets[cfg.bucket])).slice(0, 20);
    if (tracks.length > 0) {
      const orbit = makeOrbit(cfg.id, tracks, [], Math.min(cfg.confidence, tracks.length / 15));
      if (cfg.id === 'wildcard') {
        orbit.description = `Today's left turn: ${wildcardPick}`;
      }
      orbits.push(orbit);
    }
  }

  // Graceful degradation — if no orbits built, try all new artists
  if (orbits.length === 0) {
    const allNewArtists = shuffle([...hop1Artists, ...hop2Artists, ...hop3Artists]);
    let tracks: MusicTrack[] = [];
    for (const artist of allNewArtists.slice(0, 15)) {
      try {
        const topTracks = await musicService.getArtistTopTracks(artist.id);
        tracks.push(...topTracks.filter(isVerifiedNew));
      } catch { /* skip */ }
      if (tracks.length >= 25) break;
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
