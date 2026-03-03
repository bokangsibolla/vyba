import { TrackWithGenres } from '../spotify/types';
import { vibeColors } from '../tokens';

export interface VibeCluster {
  id: number;
  label: string;
  description: string;
  color: { name: string; from: string; to: string };
  tracks: TrackWithGenres[];
  topGenres: string[];
}

// Genre → vibe mapping. Each vibe has a set of genre keywords that match it.
const VIBE_DEFINITIONS: { label: string; description: string; keywords: string[] }[] = [
  {
    label: 'golden hour',
    description: 'Warm, feel-good, windows-down energy',
    keywords: ['pop', 'indie pop', 'sunshine', 'feel-good', 'summer', 'tropical', 'dance pop', 'electropop'],
  },
  {
    label: 'night drive',
    description: 'Dark, moody, cruising alone at 2am',
    keywords: ['dark', 'synthwave', 'retrowave', 'darkwave', 'industrial', 'cyberpunk', 'synthpop', 'new wave', 'post-punk'],
  },
  {
    label: 'slow morning',
    description: 'Quiet, acoustic, coffee in hand',
    keywords: ['acoustic', 'folk', 'singer-songwriter', 'indie folk', 'chamber', 'soft', 'mellow', 'bedroom'],
  },
  {
    label: 'main character',
    description: 'You against the world, cinematic confidence',
    keywords: ['hip hop', 'rap', 'r&b', 'trap', 'urban', 'swagger', 'confidence', 'contemporary r&b'],
  },
  {
    label: 'deep focus',
    description: 'Instrumental, hypnotic, locked in',
    keywords: ['ambient', 'electronic', 'minimal', 'downtempo', 'idm', 'instrumental', 'study', 'lo-fi', 'chillhop'],
  },
  {
    label: 'the comedown',
    description: 'Melancholy, beautiful, sitting with your thoughts',
    keywords: ['sad', 'melancholy', 'emo', 'shoegaze', 'slowcore', 'dream pop', 'ethereal', 'post-rock'],
  },
  {
    label: 'basement party',
    description: 'Heavy bass, high energy, bodies moving',
    keywords: ['edm', 'house', 'techno', 'bass', 'drum and bass', 'dubstep', 'dance', 'rave', 'club', 'uk garage'],
  },
  {
    label: 'lost in translation',
    description: 'Eclectic, worldly, hard to pin down',
    keywords: ['world', 'afrobeats', 'latin', 'reggaeton', 'k-pop', 'j-pop', 'bossa', 'samba', 'afro', 'global'],
  },
  {
    label: 'after midnight',
    description: 'Intimate, electronic, headphones-only',
    keywords: ['chill', 'chillwave', 'vapor', 'lounge', 'trip-hop', 'neo soul', 'future', 'alternative r&b'],
  },
  {
    label: 'raw nerve',
    description: 'Loud, fast, unapologetic',
    keywords: ['rock', 'punk', 'metal', 'hardcore', 'grunge', 'alternative rock', 'garage rock', 'noise'],
  },
  {
    label: 'sunday ritual',
    description: 'Easy, familiar, comfort listening',
    keywords: ['soul', 'jazz', 'blues', 'classic', 'motown', 'gospel', 'smooth', 'vintage', 'retro soul'],
  },
];

function scoreTrackForVibe(genres: string[], vibeKeywords: string[]): number {
  let score = 0;
  const lowerGenres = genres.map((g) => g.toLowerCase());
  for (const genre of lowerGenres) {
    for (const keyword of vibeKeywords) {
      if (genre.includes(keyword)) {
        score += 1;
      }
    }
  }
  return score;
}

export function buildVibeMap(tracks: TrackWithGenres[], maxVibes = 6): VibeCluster[] {
  // Score each track against each vibe
  const trackVibeScores = tracks.map((track) => {
    const scores = VIBE_DEFINITIONS.map((vibe) => ({
      label: vibe.label,
      score: scoreTrackForVibe(track.genres, vibe.keywords),
    }));
    // Best matching vibe
    scores.sort((a, b) => b.score - a.score);
    return { track, bestVibe: scores[0].label, bestScore: scores[0].score };
  });

  // Group tracks by their best vibe
  const vibeGroups = new Map<string, TrackWithGenres[]>();
  for (const { track, bestVibe, bestScore } of trackVibeScores) {
    // If no genre matches at all, put in a catch-all
    const vibe = bestScore > 0 ? bestVibe : '_uncategorized';
    if (!vibeGroups.has(vibe)) vibeGroups.set(vibe, []);
    vibeGroups.get(vibe)!.push(track);
  }

  // Distribute uncategorized tracks into existing vibes or create "lost in translation"
  const uncategorized = vibeGroups.get('_uncategorized') || [];
  vibeGroups.delete('_uncategorized');

  if (uncategorized.length > 0) {
    if (vibeGroups.size === 0) {
      // All tracks are uncategorized — use "lost in translation"
      vibeGroups.set('lost in translation', uncategorized);
    } else {
      // Spread uncategorized across existing vibes proportionally
      const vibeKeys = Array.from(vibeGroups.keys());
      uncategorized.forEach((track, i) => {
        const key = vibeKeys[i % vibeKeys.length];
        vibeGroups.get(key)!.push(track);
      });
    }
  }

  // Sort vibes by track count, take top N
  const sorted = Array.from(vibeGroups.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, maxVibes);

  // If there are small vibes (< 3 tracks), merge into "lost in translation"
  const final: [string, TrackWithGenres[]][] = [];
  const overflow: TrackWithGenres[] = [];
  for (const [label, groupTracks] of sorted) {
    if (groupTracks.length >= 3) {
      final.push([label, groupTracks]);
    } else {
      overflow.push(...groupTracks);
    }
  }
  if (overflow.length >= 3) {
    final.push(['lost in translation', overflow]);
  } else if (overflow.length > 0 && final.length > 0) {
    final[final.length - 1][1].push(...overflow);
  }

  // Build VibeCluster objects
  return final.map(([label, clusterTracks], i) => {
    const vibeDef = VIBE_DEFINITIONS.find((v) => v.label === label) || {
      label,
      description: 'Eclectic, worldly, hard to pin down',
    };

    // Find top genres in this cluster
    const genreCounts = new Map<string, number>();
    for (const track of clusterTracks) {
      for (const genre of track.genres) {
        genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
      }
    }
    const topGenres = Array.from(genreCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([g]) => g);

    return {
      id: i,
      label: vibeDef.label,
      description: vibeDef.description,
      color: vibeColors[i % vibeColors.length],
      tracks: clusterTracks,
      topGenres,
    };
  });
}
