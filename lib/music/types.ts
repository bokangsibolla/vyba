export interface MusicTrack {
  id: string;
  name: string;
  artist: string;
  artistId: string;
  album: string;
  albumId: string;
  imageUrl: string;
  externalUrl: string;
  uri: string;
  service: 'spotify' | 'deezer';
}

export interface MusicArtist {
  id: string;
  name: string;
  genres: string[];
  imageUrl: string;
  service: 'spotify' | 'deezer';
}

export interface MusicService {
  readonly service: 'spotify' | 'deezer';

  getTopTracks(timeRange: 'short' | 'medium' | 'long', limit?: number): Promise<MusicTrack[]>;
  getTopArtists(timeRange: 'short' | 'medium' | 'long', limit?: number): Promise<MusicArtist[]>;
  searchTracks(query: string, limit?: number): Promise<MusicTrack[]>;
  searchTracksByArtist(artistName: string, limit?: number): Promise<MusicTrack[]>;
  createPlaylist(name: string, description: string, trackUris: string[]): Promise<string>;
}
