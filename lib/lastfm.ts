export interface LastfmSimilarArtist {
  name: string;
  match: string;
  url: string;
}

export interface LastfmTag {
  name: string;
  count: number;
}

export async function getSimilarArtistsBatch(
  artistNames: string[],
  limit = 50
): Promise<Map<string, LastfmSimilarArtist[]>> {
  const result = new Map<string, LastfmSimilarArtist[]>();
  if (artistNames.length === 0) return result;

  try {
    const res = await fetch('/api/lastfm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artists: artistNames, method: 'artist.getSimilar', limit }),
    });
    if (!res.ok) return result;
    const data = await res.json();
    for (const [artist, payload] of Object.entries(data.results ?? {})) {
      const similar = (payload as any)?.similarartists?.artist;
      result.set(artist, Array.isArray(similar) ? similar : []);
    }
  } catch {
    // non-critical
  }
  return result;
}

export async function getArtistTagsBatch(
  artistNames: string[],
): Promise<Map<string, LastfmTag[]>> {
  const result = new Map<string, LastfmTag[]>();
  if (artistNames.length === 0) return result;

  try {
    const res = await fetch('/api/lastfm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artists: artistNames, method: 'artist.getTopTags', limit: 10 }),
    });
    if (!res.ok) return result;
    const data = await res.json();
    for (const [artist, payload] of Object.entries(data.results ?? {})) {
      const tags = (payload as any)?.toptags?.tag;
      if (Array.isArray(tags)) {
        result.set(artist, tags.map((t: any) => ({
          name: t.name.toLowerCase(),
          count: Number(t.count) || 0,
        })));
      }
    }
  } catch {
    // non-critical
  }
  return result;
}

// Single-artist wrappers (kept for compat)
export async function getSimilarArtists(artistName: string, limit = 30): Promise<LastfmSimilarArtist[]> {
  const map = await getSimilarArtistsBatch([artistName], limit);
  return map.get(artistName) ?? [];
}

export async function getArtistTags(artistName: string): Promise<LastfmTag[]> {
  const map = await getArtistTagsBatch([artistName]);
  return map.get(artistName) ?? [];
}
