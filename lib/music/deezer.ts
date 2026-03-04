import { MusicService, MusicTrack, MusicArtist } from './types';

const BASE = 'https://api.deezer.com';

export class DeezerService implements MusicService {
  readonly service = 'deezer' as const;
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async fetch<T>(path: string): Promise<T> {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${BASE}${path}${sep}access_token=${this.token}`);
    if (!res.ok) throw new Error(`Deezer API ${res.status}`);
    return res.json();
  }

  async getTopTracks(_timeRange: 'short' | 'medium' | 'long', limit = 50): Promise<MusicTrack[]> {
    const data = await this.fetch<{ data: DeezerRawTrack[] }>(`/user/me/charts/tracks?limit=${limit}`);
    return (data.data ?? []).map(toMusicTrack);
  }

  async getTopArtists(_timeRange: 'short' | 'medium' | 'long', limit = 50): Promise<MusicArtist[]> {
    const data = await this.fetch<{ data: DeezerRawArtist[] }>(`/user/me/charts/artists?limit=${limit}`);
    return (data.data ?? []).map(toMusicArtist);
  }

  async searchTracks(query: string, limit = 10): Promise<MusicTrack[]> {
    const q = encodeURIComponent(query);
    const data = await this.fetch<{ data: DeezerRawTrack[] }>(`/search?q=${q}&limit=${limit}`);
    return (data.data ?? []).map(toMusicTrack);
  }

  async getTopArtistsAllRanges(): Promise<{ shortTerm: MusicArtist[]; mediumTerm: MusicArtist[]; longTerm: MusicArtist[] }> {
    // Deezer doesn't support time ranges — return same list for all three
    const artists = await this.getTopArtists('short');
    return { shortTerm: artists, mediumTerm: artists, longTerm: artists };
  }

  async searchTracksByArtist(artistName: string, limit = 5): Promise<MusicTrack[]> {
    return this.searchTracks(`artist:"${artistName}"`, limit);
  }

  async discoverByGenres(genres: string[], excludeIds: Set<string>, limit = 30): Promise<MusicTrack[]> {
    const results: MusicTrack[] = [];
    const seen = new Set<string>();

    for (const genre of genres.slice(0, 5)) {
      if (results.length >= limit) break;
      const tracks = await this.searchTracks(genre, 10);
      for (const track of tracks) {
        if (!seen.has(track.id) && !excludeIds.has(track.id)) {
          seen.add(track.id);
          results.push(track);
        }
      }
    }

    return results.slice(0, limit);
  }

  async createPlaylist(name: string, _description: string, trackUris: string[]): Promise<string> {
    const res = await fetch(`${BASE}/user/me/playlists?access_token=${this.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `title=${encodeURIComponent(name)}`,
    });
    const playlist = await res.json();

    const trackIds = trackUris.map(uri => uri.replace('deezer:track:', ''));
    await fetch(`${BASE}/playlist/${playlist.id}/tracks?access_token=${this.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `songs=${trackIds.join(',')}`,
    });

    return `https://www.deezer.com/playlist/${playlist.id}`;
  }
}

interface DeezerRawTrack {
  id: number;
  title: string;
  artist: { id: number; name: string };
  album: { id: number; title: string; cover_medium: string };
  link: string;
}

interface DeezerRawArtist {
  id: number;
  name: string;
  picture_medium: string;
}

function toMusicTrack(t: DeezerRawTrack): MusicTrack {
  return {
    id: String(t.id),
    name: t.title,
    artist: t.artist.name,
    artistId: String(t.artist.id),
    album: t.album.title,
    albumId: String(t.album.id),
    imageUrl: t.album.cover_medium,
    externalUrl: t.link,
    uri: `deezer:track:${t.id}`,
    service: 'deezer',
  };
}

function toMusicArtist(a: DeezerRawArtist): MusicArtist {
  return {
    id: String(a.id),
    name: a.name,
    genres: [],
    imageUrl: a.picture_medium,
    service: 'deezer',
  };
}
