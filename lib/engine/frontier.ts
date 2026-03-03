import { SpotifyArtist } from '@/lib/spotify/types';
import { TasteFrontier } from './types';

/**
 * Detect the taste frontier by comparing listening habits across time ranges.
 *
 * Short-term artists not found in long-term listening represent new interests
 * (the "frontier"), while long-term artists absent from short-term represent
 * fading interests. A significant shift (5+ new artists) flags the taste
 * profile as actively evolving.
 */
export function detectTasteFrontier(
  shortTermArtists: SpotifyArtist[],
  mediumTermArtists: SpotifyArtist[],
  longTermArtists: SpotifyArtist[]
): TasteFrontier {
  // Build ID sets for each time range
  const shortTermIds = new Set(shortTermArtists.map((a) => a.id));
  const longTermIds = new Set(longTermArtists.map((a) => a.id));

  // Artists in short-term but NOT in long-term (new interests)
  const shortTermOnly = shortTermArtists.filter((a) => !longTermIds.has(a.id));

  // Artists in long-term but NOT in short-term (fading interests)
  const longTermOnly = longTermArtists.filter((a) => !shortTermIds.has(a.id));

  // Collect deduplicated genres from frontier artists
  const frontierGenreSet = new Set<string>();
  for (const artist of shortTermOnly) {
    for (const genre of artist.genres) {
      frontierGenreSet.add(genre);
    }
  }
  const frontierGenres = Array.from(frontierGenreSet);

  // Collect deduplicated genres from long-term (core) artists
  const coreGenreSet = new Set<string>();
  for (const artist of longTermArtists) {
    for (const genre of artist.genres) {
      coreGenreSet.add(genre);
    }
  }
  const coreGenres = Array.from(coreGenreSet);

  // Significant taste shift if 5+ artists are new to the frontier
  const evolving = shortTermOnly.length >= 5;

  return {
    shortTermOnly,
    longTermOnly,
    frontierGenres,
    coreGenres,
    evolving,
  };
}

/**
 * Get genres that are emerging (in frontier but not core).
 * These get a 1.5x boost in the scoring engine.
 */
export function getEmergingGenres(frontier: TasteFrontier): string[] {
  const coreSet = new Set(frontier.coreGenres);
  return frontier.frontierGenres.filter((g) => !coreSet.has(g));
}
