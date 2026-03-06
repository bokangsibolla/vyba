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
  popularity?: number;
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
  getTopArtistsAllRanges(): Promise<{ shortTerm: MusicArtist[]; mediumTerm: MusicArtist[]; longTerm: MusicArtist[] }>;
  searchTracks(query: string): Promise<MusicTrack[]>;
  searchTracksByArtist(artistName: string): Promise<MusicTrack[]>;
  discoverByGenres(genres: string[], excludeIds: Set<string>, limit: number): Promise<MusicTrack[]>;
  createPlaylist(name: string, description: string, trackUris: string[]): Promise<string>;

  /** Get artists related to a given artist (Spotify: /artists/{id}/related-artists) */
  getRelatedArtists(artistId: string): Promise<MusicArtist[]>;

  /** Get an artist's top tracks (Spotify: /artists/{id}/top-tracks) */
  getArtistTopTracks(artistId: string): Promise<MusicTrack[]>;

  /** Get personalized recommendations from seed artists/tracks/genres */
  getRecommendations(opts: {
    seedArtistIds?: string[];
    seedTrackIds?: string[];
    seedGenres?: string[];
    limit?: number;
  }): Promise<MusicTrack[]>;

  /** Get the user's full saved/liked track IDs and artist IDs for exclusion */
  getLibraryExclusions(): Promise<{ trackIds: Set<string>; artistIds: Set<string>; artistNames: Set<string> }>;

  /**
   * Check which tracks from a list are already in the user's library.
   * Returns a Set of track IDs that ARE in the library (should be excluded).
   * Uses GET /me/tracks/contains — the ONLY reliable way to check.
   */
  checkTracksInLibrary(trackIds: string[]): Promise<Set<string>>;
}
