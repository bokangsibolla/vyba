import { SpotifyTrack, SpotifyArtist, TrackWithGenres } from './types';

const BASE = 'https://api.spotify.com/v1';

async function spotifyFetch<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Spotify API error: ${res.status}`);
  return res.json();
}

export async function getTopTracks(
  token: string,
  timeRange: 'short_term' | 'medium_term' | 'long_term',
  limit = 50
): Promise<SpotifyTrack[]> {
  const data = await spotifyFetch<{ items: SpotifyTrack[] }>(
    token,
    `/me/top/tracks?time_range=${timeRange}&limit=${limit}`
  );
  return data.items;
}

export async function getTopArtists(
  token: string,
  timeRange: 'short_term' | 'medium_term' | 'long_term',
  limit = 50
): Promise<SpotifyArtist[]> {
  const data = await spotifyFetch<{ items: SpotifyArtist[] }>(
    token,
    `/me/top/artists?time_range=${timeRange}&limit=${limit}`
  );
  return data.items;
}

export async function getAllTopTracksWithGenres(
  token: string
): Promise<TrackWithGenres[]> {
  const [shortTracks, mediumTracks, longTracks, shortArtists, mediumArtists, longArtists] =
    await Promise.all([
      getTopTracks(token, 'short_term'),
      getTopTracks(token, 'medium_term'),
      getTopTracks(token, 'long_term'),
      getTopArtists(token, 'short_term'),
      getTopArtists(token, 'medium_term'),
      getTopArtists(token, 'long_term'),
    ]);

  // Build artist → genres map
  const artistGenres = new Map<string, string[]>();
  for (const artist of [...shortArtists, ...mediumArtists, ...longArtists]) {
    if (!artistGenres.has(artist.id)) {
      artistGenres.set(artist.id, artist.genres);
    }
  }

  // Deduplicate tracks
  const seen = new Set<string>();
  const unique: SpotifyTrack[] = [];
  for (const track of [...shortTracks, ...mediumTracks, ...longTracks]) {
    if (!seen.has(track.id)) {
      seen.add(track.id);
      unique.push(track);
    }
  }

  // Attach genres from artists
  return unique.map((track) => {
    const genres: string[] = [];
    for (const artist of track.artists) {
      const g = artistGenres.get(artist.id);
      if (g) genres.push(...g);
    }
    return { ...track, genres: Array.from(new Set(genres)) };
  });
}

// Discovery via search — find tracks by genre keywords, excluding tracks user already has
export async function discoverByGenres(
  token: string,
  genres: string[],
  excludeTrackIds: Set<string>,
  limit = 30
): Promise<SpotifyTrack[]> {
  const results: SpotifyTrack[] = [];
  const seen = new Set<string>();

  // Search with multiple genre terms to get variety
  const searchTerms = genres.slice(0, 5);

  for (const genre of searchTerms) {
    if (results.length >= limit) break;

    const q = encodeURIComponent(`genre:"${genre}"`);
    const data = await spotifyFetch<{ tracks: { items: SpotifyTrack[] } }>(
      token,
      `/search?q=${q}&type=track&limit=10`
    );

    for (const track of data.tracks.items) {
      if (!seen.has(track.id) && !excludeTrackIds.has(track.id)) {
        seen.add(track.id);
        results.push(track);
      }
    }
  }

  // Shuffle to mix genres
  for (let i = results.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [results[i], results[j]] = [results[j], results[i]];
  }

  return results.slice(0, limit);
}

export async function createPlaylist(
  token: string,
  name: string,
  description: string,
  trackUris: string[]
): Promise<{ url: string; id: string }> {
  const user = await spotifyFetch<{ id: string }>(token, '/me');

  const playlist = await fetch(`${BASE}/users/${user.id}/playlists`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, description, public: false }),
  }).then((r) => r.json());

  await fetch(`${BASE}/playlists/${playlist.id}/items`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ uris: trackUris }),
  });

  return { url: playlist.external_urls.spotify, id: playlist.id };
}

export async function searchPlaylistsForTrack(
  token: string,
  trackName: string,
  artistName: string,
  limit = 5
): Promise<{ id: string; name: string; trackCount: number }[]> {
  const q = encodeURIComponent(`${trackName} ${artistName}`);
  const data = await spotifyFetch<{
    playlists: {
      items: { id: string; name: string; tracks: { total: number } }[];
    };
  }>(token, `/search?q=${q}&type=playlist&limit=${limit}`);

  return data.playlists.items
    .filter((p) => p.tracks.total >= 10 && p.tracks.total <= 500)
    .map((p) => ({ id: p.id, name: p.name, trackCount: p.tracks.total }));
}

export async function getPlaylistTracks(
  token: string,
  playlistId: string,
  limit = 100
): Promise<SpotifyTrack[]> {
  const data = await spotifyFetch<{
    items: { track: SpotifyTrack | null }[];
  }>(
    token,
    `/playlists/${playlistId}/tracks?limit=${limit}&fields=items(track(id,name,artists(id,name),album(id,name,images),uri,preview_url,external_urls))`
  );

  return data.items
    .map((item) => item.track)
    .filter((track): track is SpotifyTrack => track !== null);
}

export async function searchTracksByArtist(
  token: string,
  artistName: string,
  limit = 5
): Promise<SpotifyTrack[]> {
  const q = encodeURIComponent(`artist:"${artistName}"`);
  const data = await spotifyFetch<{ tracks: { items: SpotifyTrack[] } }>(
    token,
    `/search?q=${q}&type=track&limit=${limit}`
  );
  return data.tracks.items;
}

export async function getAllTimeRangeArtists(
  token: string
): Promise<{
  shortTerm: SpotifyArtist[];
  mediumTerm: SpotifyArtist[];
  longTerm: SpotifyArtist[];
}> {
  const [shortTerm, mediumTerm, longTerm] = await Promise.all([
    getTopArtists(token, 'short_term'),
    getTopArtists(token, 'medium_term'),
    getTopArtists(token, 'long_term'),
  ]);
  return { shortTerm, mediumTerm, longTerm };
}
