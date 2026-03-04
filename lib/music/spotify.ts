import { MusicService, MusicTrack, MusicArtist } from './types';

const BASE = 'https://api.spotify.com/v1';

const TIME_RANGE_MAP = {
  short: 'short_term',
  medium: 'medium_term',
  long: 'long_term',
} as const;

export class SpotifyService implements MusicService {
  readonly service = 'spotify' as const;
  readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async fetch<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) throw new Error(`Spotify API ${res.status}`);
    return res.json();
  }

  async getTopTracks(timeRange: 'short' | 'medium' | 'long', limit = 50): Promise<MusicTrack[]> {
    const data = await this.fetch<{ items: SpotifyRawTrack[] }>(
      `/me/top/tracks?time_range=${TIME_RANGE_MAP[timeRange]}&limit=${limit}`
    );
    return data.items.map(toMusicTrack);
  }

  async getTopArtists(timeRange: 'short' | 'medium' | 'long', limit = 50): Promise<MusicArtist[]> {
    const data = await this.fetch<{ items: SpotifyRawArtist[] }>(
      `/me/top/artists?time_range=${TIME_RANGE_MAP[timeRange]}&limit=${limit}`
    );
    return data.items.map(toMusicArtist);
  }

  async searchTracks(query: string, limit = 10): Promise<MusicTrack[]> {
    const q = encodeURIComponent(query);
    const data = await this.fetch<{ tracks: { items: SpotifyRawTrack[] } }>(
      `/search?q=${q}&type=track&limit=${limit}`
    );
    return data.tracks.items.map(toMusicTrack);
  }

  async getTopArtistsAllRanges(): Promise<{ shortTerm: MusicArtist[]; mediumTerm: MusicArtist[]; longTerm: MusicArtist[] }> {
    const [shortTerm, mediumTerm, longTerm] = await Promise.all([
      this.getTopArtists('short'),
      this.getTopArtists('medium'),
      this.getTopArtists('long'),
    ]);
    return { shortTerm, mediumTerm, longTerm };
  }

  async searchTracksByArtist(artistName: string, limit = 5): Promise<MusicTrack[]> {
    return this.searchTracks(`artist:"${artistName}"`, limit);
  }

  async discoverByGenres(genres: string[], excludeIds: Set<string>, limit = 30): Promise<MusicTrack[]> {
    const results: MusicTrack[] = [];
    const seen = new Set<string>();

    for (const genre of genres.slice(0, 5)) {
      if (results.length >= limit) break;
      const q = encodeURIComponent(`genre:"${genre}"`);
      const data = await this.fetch<{ tracks: { items: SpotifyRawTrack[] } }>(
        `/search?q=${q}&type=track&limit=10`
      );
      for (const track of data.tracks.items) {
        if (!seen.has(track.id) && !excludeIds.has(track.id)) {
          seen.add(track.id);
          results.push(toMusicTrack(track));
        }
      }
    }

    // Shuffle
    for (let i = results.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [results[i], results[j]] = [results[j], results[i]];
    }

    return results.slice(0, limit);
  }

  async createPlaylist(name: string, description: string, trackUris: string[]): Promise<string> {
    const user = await this.fetch<{ id: string }>('/me');
    const createRes = await fetch(`${BASE}/users/${user.id}/playlists`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, public: false }),
    });
    if (!createRes.ok) {
      const body = await createRes.text();
      throw new Error(`Spotify create playlist ${createRes.status}: ${body}`);
    }
    const playlist = await createRes.json();

    const addRes = await fetch(`${BASE}/playlists/${playlist.id}/items`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: trackUris }),
    });
    if (!addRes.ok) {
      const body = await addRes.text();
      throw new Error(`Spotify add tracks ${addRes.status}: ${body}`);
    }

    return playlist.external_urls.spotify;
  }
}

interface SpotifyRawTrack {
  id: string;
  name: string;
  artists: { id: string; name: string }[];
  album: { id: string; name: string; images: { url: string }[] };
  uri: string;
  external_urls: { spotify: string };
}

interface SpotifyRawArtist {
  id: string;
  name: string;
  genres: string[];
  images: { url: string }[];
}

function toMusicTrack(t: SpotifyRawTrack): MusicTrack {
  return {
    id: t.id,
    name: t.name,
    artist: t.artists.map(a => a.name).join(', '),
    artistId: t.artists[0]?.id ?? '',
    album: t.album.name,
    albumId: t.album.id,
    imageUrl: t.album.images[0]?.url ?? '',
    externalUrl: t.external_urls.spotify,
    uri: t.uri,
    service: 'spotify',
  };
}

function toMusicArtist(a: SpotifyRawArtist): MusicArtist {
  return {
    id: a.id,
    name: a.name,
    genres: a.genres,
    imageUrl: a.images[0]?.url ?? '',
    service: 'spotify',
  };
}
