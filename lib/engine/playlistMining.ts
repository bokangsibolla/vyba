import { SpotifyTrack } from '@/lib/spotify/types';
import { searchPlaylistsForTrack, getPlaylistTracks } from '@/lib/spotify/api';
import { CoOccurrence } from './types';
import { getCached, setCache, CACHE_TTL, getCacheKey } from './cache';

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function minePlaylistCoOccurrences(
  token: string,
  seedTracks: SpotifyTrack[],
  userTrackIds: Set<string>,
  maxPlaylists = 30
): Promise<CoOccurrence[]> {
  // Check cache first
  const cacheKey = getCacheKey(
    'playlist_mining',
    seedTracks.map((t) => t.id)
  );
  const cached = getCached<CoOccurrence[]>(cacheKey);
  if (cached) return cached;

  // Take the first 10 seed tracks
  const seeds = seedTracks.slice(0, 10);

  // Search for playlists containing each seed track
  const playlistIds = new Set<string>();
  const playlistQueue: string[] = [];

  for (const seed of seeds) {
    if (playlistIds.size >= maxPlaylists) break;

    const artistName = seed.artists[0]?.name ?? 'Unknown';
    const playlists = await searchPlaylistsForTrack(
      token,
      seed.name,
      artistName,
      5
    );

    for (const pl of playlists) {
      if (playlistIds.size >= maxPlaylists) break;
      if (!playlistIds.has(pl.id)) {
        playlistIds.add(pl.id);
        playlistQueue.push(pl.id);
      }
    }
  }

  // Fetch tracks from each playlist in batches of 5
  const coOccurrenceMap = new Map<
    string,
    {
      track: SpotifyTrack;
      count: number;
      sourcePlaylistIds: Set<string>;
    }
  >();

  for (let i = 0; i < playlistQueue.length; i += 5) {
    const batch = playlistQueue.slice(i, i + 5);

    const batchResults = await Promise.all(
      batch.map((plId) => getPlaylistTracks(token, plId))
    );

    for (let b = 0; b < batch.length; b++) {
      const playlistId = batch[b];
      const tracks = batchResults[b];

      for (const track of tracks) {
        // Skip tracks the user already has
        if (userTrackIds.has(track.id)) continue;

        const existing = coOccurrenceMap.get(track.id);
        if (existing) {
          existing.count += 1;
          existing.sourcePlaylistIds.add(playlistId);
        } else {
          const sourcePlaylistIds = new Set<string>();
          sourcePlaylistIds.add(playlistId);
          coOccurrenceMap.set(track.id, {
            track,
            count: 1,
            sourcePlaylistIds,
          });
        }
      }
    }

    // Delay between batches to avoid rate limiting
    if (i + 5 < playlistQueue.length) {
      await delay(100);
    }
  }

  // Convert map to CoOccurrence array
  const results: CoOccurrence[] = Array.from(coOccurrenceMap.values()).map(
    ({ track, count, sourcePlaylistIds }) => ({
      trackId: track.id,
      trackName: track.name,
      artistName: track.artists[0]?.name ?? 'Unknown',
      trackUri: track.uri,
      albumImageUrl: track.album.images[0]?.url,
      count,
      sourcePlaylistCount: sourcePlaylistIds.size,
    })
  );

  // Sort by count descending
  results.sort((a, b) => b.count - a.count);

  // Cache results
  setCache(cacheKey, results, CACHE_TTL.playlistMining);

  return results;
}
