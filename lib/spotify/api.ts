import { SpotifyTrack, AudioFeatures, TrackWithFeatures } from './types';

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

export async function getAudioFeatures(
  token: string,
  trackIds: string[]
): Promise<AudioFeatures[]> {
  const batches: AudioFeatures[] = [];
  for (let i = 0; i < trackIds.length; i += 100) {
    const ids = trackIds.slice(i, i + 100).join(',');
    const data = await spotifyFetch<{ audio_features: AudioFeatures[] }>(
      token,
      `/audio-features?ids=${ids}`
    );
    batches.push(...data.audio_features.filter(Boolean));
  }
  return batches;
}

export async function getAllTopTracksWithFeatures(
  token: string
): Promise<TrackWithFeatures[]> {
  const [short, medium, long] = await Promise.all([
    getTopTracks(token, 'short_term'),
    getTopTracks(token, 'medium_term'),
    getTopTracks(token, 'long_term'),
  ]);

  const seen = new Set<string>();
  const unique: SpotifyTrack[] = [];
  for (const track of [...short, ...medium, ...long]) {
    if (!seen.has(track.id)) {
      seen.add(track.id);
      unique.push(track);
    }
  }

  const features = await getAudioFeatures(
    token,
    unique.map((t) => t.id)
  );

  const featuresMap = new Map(features.map((f) => [f.id, f]));

  return unique
    .filter((t) => featuresMap.has(t.id))
    .map((t) => ({ ...t, features: featuresMap.get(t.id)! }));
}

export async function getRecommendations(
  token: string,
  seedTrackIds: string[],
  targetFeatures: Partial<AudioFeatures>,
  limit = 30
): Promise<SpotifyTrack[]> {
  const params = new URLSearchParams({
    seed_tracks: seedTrackIds.slice(0, 5).join(','),
    limit: String(limit),
  });

  const featureKeys: (keyof AudioFeatures)[] = [
    'danceability', 'energy', 'valence', 'acousticness', 'instrumentalness', 'tempo',
  ];
  for (const key of featureKeys) {
    if (key in targetFeatures && key !== 'id') {
      params.set(`target_${key}`, String(targetFeatures[key]));
    }
  }

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
