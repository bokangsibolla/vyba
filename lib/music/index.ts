import { MusicService } from './types';
import { SpotifyService } from './spotify';
import { DeezerService } from './deezer';

export function createMusicService(service: 'spotify' | 'deezer', token: string): MusicService {
  switch (service) {
    case 'spotify':
      return new SpotifyService(token);
    case 'deezer':
      return new DeezerService(token);
  }
}

export type { MusicService, MusicTrack, MusicArtist } from './types';
