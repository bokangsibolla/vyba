import { MusicTrack, MusicArtist } from '@/lib/music/types';

// --- Discovery & Influence Graph ---

export interface DiscoveredArtist {
  spotifyId: string;
  name: string;
  wikidataId?: string;
  source: 'wikidata' | 'playlist' | 'frontier';
  score: number;
}

export interface InfluenceEdge {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  toSpotifyId?: string;
  direction: 'influenced_by' | 'influenced';
}

export interface ArtistNode {
  wikidataId: string;
  name: string;
  spotifyId?: string;
  pageRank: number;
  isUserArtist: boolean;
}

// --- Playlist Co-occurrence ---

export interface CoOccurrence {
  trackId: string;
  trackName: string;
  artistName: string;
  trackUri: string;
  albumImageUrl?: string;
  count: number;
  sourcePlaylistCount: number;
}

// --- Taste Frontier ---

export interface TasteFrontier {
  shortTermOnly: MusicArtist[];
  longTermOnly: MusicArtist[];
  frontierGenres: string[];
  coreGenres: string[];
  evolving: boolean;
}

// --- Discovery Orbits ---

export type OrbitId = 'roots' | 'edges' | 'crowd' | 'blindspot' | 'deepwork' | 'wildcard';

export interface DiscoveryOrbit {
  id: OrbitId;
  label: string;
  description: string;
  color: {
    name: string;
    from: string;
    to: string;
  };
  tracks: MusicTrack[];
  artists: DiscoveredArtist[];
  /** Confidence score between 0 and 1 */
  confidence: number;
  status: 'pending' | 'loading' | 'ready' | 'error';
}

// --- Engine State & Progress ---

export interface SignalProgress {
  label: string;
  status: 'pending' | 'loading' | 'done' | 'error';
  detail?: string;
}

export interface EngineState {
  orbits: DiscoveryOrbit[];
  isLoading: boolean;
  progress: SignalProgress[];
  error?: string;
}

// --- Caching ---

export interface WikidataCache {
  timestamp: number;
  artistInfluences: Record<string, InfluenceEdge[]>;
  spotifyMappings: Record<string, string>;
  ttlMs: number;
}
