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

  private async fetch<T>(path: string, retries = 3): Promise<T> {
    for (let attempt = 0; attempt < retries; attempt++) {
      const res = await fetch(`${BASE}${path}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '3', 10);
        const wait = Math.max(retryAfter, 2) * 1000;
        console.log(`[vyba] Rate limited, waiting ${wait}ms (attempt ${attempt + 1}/${retries})`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      if (!res.ok) throw new Error(`Spotify API ${res.status}`);
      return res.json();
    }
    throw new Error('Spotify API 429: rate limited after retries');
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
        `/search?q=${q}&type=track&limit=20`
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

  async getRelatedArtists(artistId: string): Promise<MusicArtist[]> {
    const data = await this.fetch<{ artists: SpotifyRawArtist[] }>(
      `/artists/${artistId}/related-artists`
    );
    return data.artists.map(toMusicArtist);
  }

  async getArtistTopTracks(artistId: string): Promise<MusicTrack[]> {
    const data = await this.fetch<{ tracks: SpotifyRawTrack[] }>(
      `/artists/${artistId}/top-tracks?market=US`
    );
    return data.tracks.map(toMusicTrack);
  }

  async getRecommendations(opts: {
    seedArtistIds?: string[];
    seedTrackIds?: string[];
    seedGenres?: string[];
    limit?: number;
  }): Promise<MusicTrack[]> {
    const params = new URLSearchParams();
    if (opts.seedArtistIds?.length) params.set('seed_artists', opts.seedArtistIds.slice(0, 5).join(','));
    if (opts.seedTrackIds?.length) params.set('seed_tracks', opts.seedTrackIds.slice(0, 5).join(','));
    if (opts.seedGenres?.length) params.set('seed_genres', opts.seedGenres.slice(0, 5).join(','));
    params.set('limit', String(opts.limit ?? 20));

    // Total seeds must be <= 5
    const totalSeeds = (opts.seedArtistIds?.length ?? 0) + (opts.seedTrackIds?.length ?? 0) + (opts.seedGenres?.length ?? 0);
    if (totalSeeds === 0) return [];

    const data = await this.fetch<{ tracks: SpotifyRawTrack[] }>(
      `/recommendations?${params.toString()}`
    );
    return data.tracks.map(toMusicTrack);
  }

  async getLibraryExclusions(): Promise<{ trackIds: Set<string>; artistIds: Set<string>; artistNames: Set<string> }> {
    const trackIds = new Set<string>();
    const artistIds = new Set<string>();
    const artistNames = new Set<string>();

    // 1. Fetch saved/liked tracks (up to 500 — 10 API calls)
    try {
      let offset = 0;
      const pageSize = 50;
      for (let page = 0; page < 10; page++) {
        const data = await this.fetch<{
          items: { track: SpotifyRawTrack }[];
          total: number;
        }>(`/me/tracks?limit=${pageSize}&offset=${offset}`);

        for (const item of data.items) {
          trackIds.add(item.track.id);
          for (const artist of item.track.artists) {
            artistIds.add(artist.id);
            artistNames.add(artist.name.toLowerCase());
          }
        }

        offset += pageSize;
        if (offset >= data.total || data.items.length < pageSize) break;
      }
    } catch {
      console.log('[vyba] Could not fetch saved tracks for exclusion');
    }

    // 2. Fetch followed artists (up to 200)
    try {
      let after: string | undefined;
      for (let page = 0; page < 4; page++) {
        const afterParam = after ? `&after=${after}` : '';
        const data = await this.fetch<{
          artists: { items: SpotifyRawArtist[]; cursors?: { after?: string } };
        }>(`/me/following?type=artist&limit=50${afterParam}`);

        for (const artist of data.artists.items) {
          artistIds.add(artist.id);
          artistNames.add(artist.name.toLowerCase());
        }

        after = data.artists.cursors?.after;
        if (!after || data.artists.items.length < 50) break;
      }
    } catch {
      console.log('[vyba] Could not fetch followed artists for exclusion');
    }

    // 3. Fetch recently played (last 50)
    try {
      const data = await this.fetch<{
        items: { track: SpotifyRawTrack }[];
      }>('/me/player/recently-played?limit=50');

      for (const item of data.items) {
        trackIds.add(item.track.id);
        for (const artist of item.track.artists) {
          artistIds.add(artist.id);
          artistNames.add(artist.name.toLowerCase());
        }
      }
    } catch {
      console.log('[vyba] Could not fetch recently played for exclusion');
    }

    console.log(`[vyba] Library exclusions: ${trackIds.size} tracks, ${artistIds.size} artists`);
    return { trackIds, artistIds, artistNames };
  }

  async checkTracksInLibrary(trackIds: string[]): Promise<Set<string>> {
    const inLibrary = new Set<string>();

    // Spotify allows checking 50 tracks per request
    for (let i = 0; i < trackIds.length; i += 50) {
      const batch = trackIds.slice(i, i + 50);
      try {
        const ids = batch.join(',');
        const data = await this.fetch<boolean[]>(
          `/me/tracks/contains?ids=${ids}`
        );
        for (let j = 0; j < batch.length; j++) {
          if (data[j]) inLibrary.add(batch[j]);
        }
      } catch {
        console.log('[vyba] checkTracksInLibrary failed for batch, skipping');
      }
    }

    return inLibrary;
  }

  async createPlaylist(name: string, description: string, trackUris: string[]): Promise<string> {
    // Dedupe URIs before sending to Spotify
    const uniqueUris = Array.from(new Set(trackUris));

    const createRes = await fetch(`${BASE}/me/playlists`, {
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
      body: JSON.stringify({ uris: uniqueUris }),
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
