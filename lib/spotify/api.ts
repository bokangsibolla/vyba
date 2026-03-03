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
  // Fetch tracks and artists in parallel
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
    // Deduplicate genres
    return { ...track, genres: Array.from(new Set(genres)) };
  });
}

export async function getRecommendations(
  token: string,
  seedTrackIds: string[],
  limit = 30
): Promise<SpotifyTrack[]> {
  const params = new URLSearchParams({
    seed_tracks: seedTrackIds.slice(0, 5).join(','),
    limit: String(limit),
  });

  const data = await spotifyFetch<{ tracks: SpotifyTrack[] }>(
    token,
    `/recommendations?${params}`
  );
  return data.tracks;
}

export async function createPlaylist(
  token: string,
  name: string,
  description: string,
  trackUris: string[]
): Promise<string> {
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

  return playlist.external_urls.spotify;
}
