export interface LastfmSimilarArtist {
  name: string;
  match: string; // similarity score 0-1 as string
  url: string;
}

export interface LastfmTag {
  name: string;
  count: number; // tag weight
}

/**
 * Get similar artists from Last.fm via our server-side API route.
 */
export async function getSimilarArtists(
  artistName: string,
  limit = 30
): Promise<LastfmSimilarArtist[]> {
  try {
    const params = new URLSearchParams({
      artist: artistName,
      method: 'artist.getSimilar',
      limit: String(limit),
    });
    const res = await fetch(`/api/lastfm?${params.toString()}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data?.similarartists?.artist ?? [];
  } catch {
    return [];
  }
}

/**
 * Get top tags for an artist from Last.fm.
 * Tags represent genres, moods, and descriptors (e.g. "shoegaze", "melancholic", "90s").
 */
export async function getArtistTags(
  artistName: string,
): Promise<LastfmTag[]> {
  try {
    const params = new URLSearchParams({
      artist: artistName,
      method: 'artist.getTopTags',
      limit: '10',
    });
    const res = await fetch(`/api/lastfm?${params.toString()}`);
    if (!res.ok) return [];
    const data = await res.json();
    const tags = data?.toptags?.tag ?? [];
    return tags.map((t: { name: string; count: number }) => ({
      name: t.name.toLowerCase(),
      count: Number(t.count) || 0,
    }));
  } catch {
    return [];
  }
}
