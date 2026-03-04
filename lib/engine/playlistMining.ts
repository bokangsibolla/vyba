import { MusicTrack, MusicService } from '@/lib/music/types';
import { SpotifyService } from '@/lib/music/spotify';
import { searchPlaylistsForTrack, getPlaylistTracks } from '@/lib/spotify/api';
import { CoOccurrence } from './types';
import { getCached, setCache, CACHE_TTL, getCacheKey } from './cache';

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Mine playlist co-occurrences. Only works for Spotify users (requires playlist search API).
 * The engine skips this for Deezer users entirely.
 */
export async function minePlaylistCoOccurrences(
  musicService: MusicService,
  seedTracks: MusicTrack[],
  userTrackIds: Set<string>,
  maxPlaylists = 30
): Promise<CoOccurrence[]> {
  // This only works with Spotify — Deezer has no playlist search API
  if (musicService.service !== 'spotify') return [];

  // Check cache first
  const cacheKey = getCacheKey(
    'playlist_mining',
    seedTracks.map((t) => t.id)
  );
  const cached = getCached<CoOccurrence[]>(cacheKey);
  if (cached) return cached;

  const token = (musicService as SpotifyService).token;
  if (!token) return [];

  // Take the first 10 seed tracks
  const seeds = seedTracks.slice(0, 10);

  // Search for playlists containing each seed track
  const playlistIds = new Set<string>();
  const playlistQueue: string[] = [];

  for (const seed of seeds) {
    if (playlistIds.size >= maxPlaylists) break;

    const artistName = seed.artist ?? 'Unknown';
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
      trackId: string;
      trackName: string;
      artistName: string;
      trackUri: string;
      albumImageUrl?: string;
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
        if (userTrackIds.has(track.id)) continue;

        const existing = coOccurrenceMap.get(track.id);
        if (existing) {
          existing.count += 1;
          existing.sourcePlaylistIds.add(playlistId);
        } else {
          const sourcePlaylistIds = new Set<string>();
          sourcePlaylistIds.add(playlistId);
          coOccurrenceMap.set(track.id, {
            trackId: track.id,
            trackName: track.name,
            artistName: track.artists[0]?.name ?? 'Unknown',
            trackUri: track.uri,
            albumImageUrl: track.album.images[0]?.url,
            count: 1,
            sourcePlaylistIds,
          });
        }
      }
    }

    if (i + 5 < playlistQueue.length) {
      await delay(100);
    }
  }

  // Convert map to CoOccurrence array
  const results: CoOccurrence[] = Array.from(coOccurrenceMap.values()).map(
    ({ trackId, trackName, artistName, trackUri, albumImageUrl, count, sourcePlaylistIds }) => ({
      trackId,
      trackName,
      artistName,
      trackUri,
      albumImageUrl,
      count,
      sourcePlaylistCount: sourcePlaylistIds.size,
    })
  );

  results.sort((a, b) => b.count - a.count);

  setCache(cacheKey, results, CACHE_TTL.playlistMining);

  return results;
}
