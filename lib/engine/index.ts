import { MusicService, MusicTrack, MusicArtist } from '@/lib/music/types';
import { sectionColors, sectionMeta } from '@/lib/tokens';
import {
  DiscoveryOrbit,
  EngineState,
  SignalProgress,
  OrbitId,
  InfluenceEdge,
  ArtistNode,
  CoOccurrence,
  TasteFrontier,
  DiscoveredArtist,
} from './types';
import { findWikidataIdsBySpotifyIds, findWikidataIdsByNames, getInfluences } from './wikidata';
import { getBlindspots } from './pagerank';
import { minePlaylistCoOccurrences } from './playlistMining';
import { detectTasteFrontier, getEmergingGenres } from './frontier';
import { getCached, setCache, CACHE_TTL, getCacheKey } from './cache';

// --- Score weights ---
const WEIGHTS = {
  wikidata: 0.35,
  playlist: 0.45,
  frontier: 0.20,
} as const;

const FRONTIER_BOOST = 1.5;
const MIN_TRACKS_PER_ORBIT = 15;

// --- Helpers ---

/** Keep only one track per artist within a playlist */
function dedupeByArtist(tracks: MusicTrack[]): MusicTrack[] {
  const seen = new Set<string>();
  return tracks.filter((t) => {
    const key = t.artist?.toLowerCase() ?? t.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Pad an orbit's tracks to at least MIN_TRACKS_PER_ORBIT using multiple strategies */
async function padOrbitTracks(
  musicService: MusicService,
  tracks: MusicTrack[],
  userArtistNames: string[],
  userTrackIds: Set<string>,
): Promise<MusicTrack[]> {
  if (tracks.length >= MIN_TRACKS_PER_ORBIT) return tracks;

  const result = [...tracks];
  const existingIds = new Set(tracks.map(t => t.id));
  const exclude = new Set([...userTrackIds, ...existingIds]);

  // Strategy 1: Search for more tracks by artists already in the orbit
  const orbitArtists = Array.from(new Set(tracks.map(t => t.artist)));
  for (const artist of orbitArtists) {
    if (result.length >= MIN_TRACKS_PER_ORBIT) break;
    try {
      const more = await musicService.searchTracksByArtist(artist, 5);
      for (const t of more) {
        if (!exclude.has(t.id) && result.length < MIN_TRACKS_PER_ORBIT) {
          exclude.add(t.id);
          result.push(t);
        }
      }
    } catch { /* skip */ }
  }

  // Strategy 2: Search for tracks by user's favorite artists (shuffled)
  if (result.length < MIN_TRACKS_PER_ORBIT) {
    const shuffled = [...userArtistNames].sort(() => Math.random() - 0.5);
    for (const artist of shuffled.slice(0, 10)) {
      if (result.length >= MIN_TRACKS_PER_ORBIT) break;
      try {
        const more = await musicService.searchTracksByArtist(artist, 3);
        for (const t of more) {
          if (!exclude.has(t.id) && result.length < MIN_TRACKS_PER_ORBIT) {
            exclude.add(t.id);
            result.push(t);
          }
        }
      } catch { /* skip */ }
    }
  }

  return result;
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
    { label: 'Musical influences', status: 'pending' },
    { label: 'Playlist connections', status: 'pending' },
    { label: 'Taste direction', status: 'pending' },
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

// --- Resolve artists to tracks via MusicService ---

async function resolveArtistsToTracks(
  musicService: MusicService,
  artists: ArtistNode[],
  limit: number,
): Promise<{ tracks: MusicTrack[]; discovered: DiscoveredArtist[] }> {
  const tracks: MusicTrack[] = [];
  const discovered: DiscoveredArtist[] = [];
  const seen = new Set<string>();

  for (const artist of artists.slice(0, limit)) {
    try {
      const results = await musicService.searchTracksByArtist(artist.name, 5);
      for (const track of results) {
        if (!seen.has(track.id)) {
          seen.add(track.id);
          tracks.push(track);
        }
      }
      discovered.push({
        spotifyId: artist.spotifyId ?? '',
        name: artist.name,
        wikidataId: artist.wikidataId,
        source: 'wikidata',
        score: artist.pageRank,
      });
    } catch {
      // Skip individual artist failures
    }
  }

  return { tracks, discovered };
}

async function resolveCoOccurrencesToTracks(
  coOccurrences: CoOccurrence[],
  limit: number,
): Promise<{ tracks: MusicTrack[]; discovered: DiscoveredArtist[] }> {
  const tracks: MusicTrack[] = [];
  const discovered: DiscoveredArtist[] = [];

  for (const co of coOccurrences.slice(0, limit)) {
    tracks.push({
      id: co.trackId,
      name: co.trackName,
      artist: co.artistName,
      artistId: '',
      album: '',
      albumId: '',
      imageUrl: co.albumImageUrl ?? '',
      externalUrl: `https://open.spotify.com/track/${co.trackId}`,
      uri: co.trackUri,
      service: 'spotify',
    });
    discovered.push({
      spotifyId: '',
      name: co.artistName,
      source: 'playlist',
      score: co.count / Math.max(1, co.sourcePlaylistCount),
    });
  }

  return { tracks, discovered };
}

// --- Main engine ---

export async function runDiscoveryEngine(
  musicService: MusicService,
  onProgress: (state: EngineState) => void,
): Promise<DiscoveryOrbit[]> {
  let progress = initialProgress();

  const emit = (orbits: DiscoveryOrbit[] = []) => {
    onProgress({
      orbits,
      isLoading: true,
      progress: [...progress],
    });
  };

  emit();

  // Phase 1: Fetch listening data
  progress = updateProgress(progress, 0, 'loading');
  emit();

  let allTracks: MusicTrack[];
  let allArtists: { shortTerm: MusicArtist[]; mediumTerm: MusicArtist[]; longTerm: MusicArtist[] };
  let userTrackIds: Set<string>;
  let userArtistIds: Set<string>;

  try {
    const [shortTracks, mediumTracks, longTracks, artists] = await Promise.all([
      musicService.getTopTracks('short', 50).catch(() => [] as MusicTrack[]),
      musicService.getTopTracks('medium', 50).catch(() => [] as MusicTrack[]),
      musicService.getTopTracks('long', 50).catch(() => [] as MusicTrack[]),
      musicService.getTopArtistsAllRanges().catch(() => ({ shortTerm: [], mediumTerm: [], longTerm: [] } as { shortTerm: MusicArtist[]; mediumTerm: MusicArtist[]; longTerm: MusicArtist[] })),
    ]);

    console.log('[vyba] Tracks loaded:', { short: shortTracks.length, medium: mediumTracks.length, long: longTracks.length });
    console.log('[vyba] Artists loaded:', { short: artists.shortTerm.length, medium: artists.mediumTerm.length, long: artists.longTerm.length });

    // Merge all tracks (prefer short > medium > long, dedup by id)
    const seen = new Set<string>();
    allTracks = [];
    for (const t of [...shortTracks, ...mediumTracks, ...longTracks]) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        allTracks.push(t);
      }
    }

    allArtists = artists;

    // Build user ID sets
    userTrackIds = new Set(allTracks.map((t) => t.id));
    userArtistIds = new Set([
      ...allArtists.shortTerm.map((a) => a.id),
      ...allArtists.mediumTerm.map((a) => a.id),
      ...allArtists.longTerm.map((a) => a.id),
    ]);

    progress = updateProgress(progress, 0, 'done', `${allTracks.length} tracks loaded`);
    emit();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load listening data';
    console.error('[vyba] Phase 1 error:', message);
    progress = updateProgress(progress, 0, 'error', message);
    onProgress({ orbits: [], isLoading: false, progress, error: message });
    return [];
  }

  // Phase 2: Run signals in parallel
  progress = updateProgress(progress, 1, 'loading');
  progress = updateProgress(progress, 2, 'loading');
  progress = updateProgress(progress, 3, 'loading');
  emit();

  interface WikidataResult {
    edges: InfluenceEdge[];
    blindspots: ArtistNode[];
    rootArtists: ArtistNode[];
  }

  const isDeezer = musicService.service === 'deezer';

  const [wikidataResult, playlistResult, frontierResult] = await Promise.all([
    // Signal 1: Wikidata influences
    (async (): Promise<WikidataResult | null> => {
      try {
        const allArtistIds = [
          ...allArtists.shortTerm.map((a) => a.id),
          ...allArtists.mediumTerm.map((a) => a.id),
          ...allArtists.longTerm.map((a) => a.id),
        ];
        const uniqueIds = Array.from(new Set(allArtistIds));

        // Spotify: use Spotify IDs for precise matching
        // Deezer: use artist names for label-based matching
        let wikidataMap: Map<string, string>;
        if (isDeezer) {
          const allNames = [
            ...allArtists.shortTerm.map((a) => a.name),
            ...allArtists.mediumTerm.map((a) => a.name),
            ...allArtists.longTerm.map((a) => a.name),
          ];
          const uniqueNames = Array.from(new Set(allNames));
          wikidataMap = await findWikidataIdsByNames(uniqueNames);
        } else {
          wikidataMap = await findWikidataIdsBySpotifyIds(uniqueIds);
        }

        const wikidataIds = Array.from(wikidataMap.values());

        if (wikidataIds.length === 0) {
          progress = updateProgress(progress, 1, 'done', 'No Wikidata matches');
          emit();
          return null;
        }

        const edges = await getInfluences(wikidataIds);
        const userWikidataIds = new Set(wikidataIds);
        const blindspots = getBlindspots(edges, userWikidataIds, 20);

        const rootEdges = edges.filter((e) => e.direction === 'influenced_by');
        const rootNodeIds = new Set(rootEdges.map((e) => e.toId));
        const rootArtists = Array.from(rootNodeIds)
          .filter((id) => !userWikidataIds.has(id))
          .map((id) => {
            const edge = rootEdges.find((e) => e.toId === id)!;
            return {
              wikidataId: id,
              name: edge.toName,
              spotifyId: edge.toSpotifyId,
              pageRank: 0,
              isUserArtist: false,
            };
          })
          .slice(0, 15);

        progress = updateProgress(progress, 1, 'done', `${edges.length} connections found`);
        emit();
        return { edges, blindspots, rootArtists };
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Wikidata unavailable';
        progress = updateProgress(progress, 1, 'error', detail);
        emit();
        return null;
      }
    })(),

    // Signal 2: Playlist co-occurrence (Spotify only — Deezer has no playlist search API)
    (async (): Promise<CoOccurrence[] | null> => {
      if (isDeezer) {
        progress = updateProgress(progress, 2, 'done', 'Using genre search');
        emit();
        return null;
      }
      try {
        const coOccurrences = await minePlaylistCoOccurrences(
          musicService,
          allTracks,
          userTrackIds,
          30,
        );
        progress = updateProgress(progress, 2, 'done', `${coOccurrences.length} co-occurrences`);
        emit();
        return coOccurrences;
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Playlist mining failed';
        progress = updateProgress(progress, 2, 'error', detail);
        emit();
        return null;
      }
    })(),

    // Signal 3: Taste frontier
    (async (): Promise<TasteFrontier | null> => {
      try {
        const frontier = detectTasteFrontier(
          allArtists.shortTerm,
          allArtists.mediumTerm,
          allArtists.longTerm,
        );
        const detail = frontier.evolving
          ? `${frontier.shortTermOnly.length} new interests detected`
          : 'Stable taste profile';
        progress = updateProgress(progress, 3, 'done', detail);
        emit();
        return frontier;
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Frontier detection failed';
        progress = updateProgress(progress, 3, 'error', detail);
        emit();
        return null;
      }
    })(),
  ]);

  // Phase 3: Build orbits from data we already have + minimal API calls
  // IMPORTANT: Minimize Spotify API calls to avoid 429 rate limits.
  // We use allTracks (already fetched) as the primary source.
  const orbits: DiscoveryOrbit[] = [];

  const userArtistNames = Array.from(new Set([
    ...allArtists.longTerm.map((a) => a.name),
    ...allArtists.mediumTerm.map((a) => a.name),
    ...allArtists.shortTerm.map((a) => a.name),
  ]));

  const userGenres = Array.from(new Set([
    ...allArtists.shortTerm.flatMap((a) => a.genres),
    ...allArtists.mediumTerm.flatMap((a) => a.genres),
    ...allArtists.longTerm.flatMap((a) => a.genres),
  ]));

  // Split existing tracks into pools by time range for orbit building
  const longTrackPool = allTracks.filter(t => {
    const longArtists = new Set(allArtists.longTerm.map(a => a.name));
    return longArtists.has(t.artist);
  });
  const shortTrackPool = allTracks.filter(t => {
    const shortArtists = new Set(allArtists.shortTerm.map(a => a.name));
    return shortArtists.has(t.artist);
  });
  const mediumTrackPool = allTracks.filter(t => {
    const medArtists = new Set(allArtists.mediumTerm.map(a => a.name));
    return medArtists.has(t.artist);
  });

  // Shuffle helper
  function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  console.log('[vyba] Track pools:', { long: longTrackPool.length, medium: mediumTrackPool.length, short: shortTrackPool.length, total: allTracks.length });

  // Orbit 1: ROOTS — User's long-term favorites (0 API calls)
  {
    const rootTracks = shuffle(longTrackPool.length >= 15 ? longTrackPool : allTracks).slice(0, 20);
    if (rootTracks.length > 0) {
      orbits.push(makeOrbit('roots', rootTracks, [], Math.min(1, rootTracks.length / 15)));
    }
  }

  // Orbit 2: EDGES — Short-term only tracks (recent discoveries) (0 API calls)
  {
    const shortOnly = shortTrackPool.filter(t => !longTrackPool.some(lt => lt.id === t.id));
    const edgeTracks = shuffle(shortOnly.length >= 10 ? shortOnly : shortTrackPool).slice(0, 20);
    if (edgeTracks.length > 0) {
      orbits.push(makeOrbit('edges', edgeTracks, [], Math.min(1, edgeTracks.length / 15)));
    }
  }

  // Orbit 3: CROWD — Medium-term tracks (the core taste) (0 API calls)
  {
    const crowdTracks = shuffle(mediumTrackPool.length >= 15 ? mediumTrackPool : allTracks).slice(0, 20);
    // Avoid overlap with roots
    const rootIds = new Set(orbits[0]?.tracks.map(t => t.id) ?? []);
    const filtered = crowdTracks.filter(t => !rootIds.has(t.id));
    if (filtered.length > 0) {
      orbits.push(makeOrbit('crowd', filtered.length >= 15 ? filtered : crowdTracks, [], 0.6));
    }
  }

  // Orbit 4: BLINDSPOT — Search for music outside user's bubble (max 3 API calls)
  {
    const blindTracks: MusicTrack[] = [];
    const seen = new Set<string>();
    const blindQueries = ['best albums of all time', 'classic songs everyone knows', 'critically acclaimed music'];
    for (const query of blindQueries) {
      if (blindTracks.length >= 20) break;
      try {
        const results = await musicService.searchTracks(query, 20);
        for (const t of results) {
          if (!seen.has(t.id) && !userTrackIds.has(t.id)) {
            seen.add(t.id);
            blindTracks.push(t);
          }
        }
      } catch { /* skip */ }
    }
    if (blindTracks.length > 0) {
      orbits.push(makeOrbit('blindspot', blindTracks, [], 0.5));
    }
  }

  // Orbit 5: DEEP WORK — Instrumental/ambient (max 3 API calls)
  {
    const dwTracks: MusicTrack[] = [];
    const seen = new Set<string>();
    const dwQueries = ['lo-fi beats to study to', 'ambient focus music', 'instrumental chill'];
    for (const query of dwQueries) {
      if (dwTracks.length >= 20) break;
      try {
        const results = await musicService.searchTracks(query, 20);
        for (const t of results) {
          if (!seen.has(t.id)) {
            seen.add(t.id);
            dwTracks.push(t);
          }
        }
      } catch { /* skip */ }
    }
    if (dwTracks.length > 0) {
      orbits.push(makeOrbit('deepwork', dwTracks, [], 0.5));
    }
  }

  // Orbit 6: WILDCARD — Random genre (1 API call)
  {
    const userGenreSet = new Set(userGenres);
    const wildcardGenres = [
      'afrobeats', 'bossa nova', 'k-pop', 'amapiano', 'reggaeton',
      'shoegaze', 'city pop', 'dub', 'highlife', 'tropicalia',
      'cumbia', 'grime', 'baile funk', 'dancehall', 'ethio-jazz',
    ];
    const unexplored = wildcardGenres.filter(g => !userGenreSet.has(g));
    const pick = unexplored[Math.floor(Math.random() * unexplored.length)] ?? 'world music';

    try {
      let wcTracks = await musicService.searchTracks(pick, 20);
      wcTracks = wcTracks.filter(t => !userTrackIds.has(t.id));
      if (wcTracks.length > 0) {
        const wildcardOrbit = makeOrbit('wildcard', wcTracks, [], 0.4);
        wildcardOrbit.description = `Today's left turn: ${pick}`;
        orbits.push(wildcardOrbit);
      }
    } catch { /* skip */ }
  }

  // Graceful degradation — should never hit this now
  if (orbits.length === 0 && allTracks.length > 0) {
    orbits.push(makeOrbit('edges', shuffle(allTracks).slice(0, 20), [], 0.3));
  }

  if (orbits.length === 0) {
    try {
      const fallback = await musicService.searchTracks('top hits', 20);
      if (fallback.length > 0) {
        orbits.push(makeOrbit('edges', fallback, [], 0.2));
      }
    } catch {
      // Complete failure — return empty
    }
  }

  // Final state
  onProgress({
    orbits,
    isLoading: false,
    progress,
  });

  return orbits;
}
