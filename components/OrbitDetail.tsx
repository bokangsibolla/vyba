'use client';

import { useState } from 'react';
import { DiscoveryOrbit } from '@/lib/engine/types';
import SavePlaylist from './SavePlaylist';
import styles from './OrbitDetail.module.css';

interface Props {
  orbit: DiscoveryOrbit;
  onBack: () => void;
}

const WHY_TEXT: Record<string, string> = {
  roots:
    'These artists were found through musical influence graphs. They shaped the sound of artists you already love, traced through Wikidata\'s influence relationships.',
  edges:
    'Your listening is evolving. These tracks match genres that are new in your recent listening but absent from your long-term history.',
  crowd:
    'Found by mining playlists that contain your favorite tracks. These songs frequently co-occur with yours in other listeners\' playlists.',
  blindspot:
    'High-influence artists you\'ve never explored. PageRank analysis of the influence network surfaced these as culturally significant artists outside your library.',
};

export default function OrbitDetail({ orbit, onBack }: Props) {
  const [showWhy, setShowWhy] = useState(false);

  return (
    <div>
      <header className={styles.header}>
        <button className={styles.back} onClick={onBack}>&larr;</button>
        <div className={styles.headerInfo}>
          <h1 className={styles.title}>{orbit.label}</h1>
          <p className={styles.description}>{orbit.description}</p>
        </div>
        <div
          className={styles.colorDot}
          style={{ background: `linear-gradient(135deg, ${orbit.color.from}, ${orbit.color.to})` }}
        />
      </header>

      <div className={styles.trackList}>
        {orbit.tracks.map((track) => (
          <a
            key={track.id}
            href={track.external_urls.spotify}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.trackRow}
          >
            {track.album.images.length > 0 && (
              <img
                src={track.album.images[track.album.images.length - 1]?.url}
                alt=""
                className={styles.trackImg}
                width={48}
                height={48}
              />
            )}
            <div className={styles.trackInfo}>
              <span className={styles.trackName}>{track.name}</span>
              <span className={styles.trackArtist}>
                {track.artists.map((a) => a.name).join(', ')}
              </span>
            </div>
          </a>
        ))}
      </div>

      <SavePlaylist orbit={orbit} />

      <div className={styles.whySection}>
        <button className={styles.whyToggle} onClick={() => setShowWhy(!showWhy)}>
          <span className={`${styles.whyArrow} ${showWhy ? styles.whyArrowOpen : ''}`}>&#9654;</span>
          Why these?
        </button>
        {showWhy && (
          <p className={styles.whyContent}>
            {WHY_TEXT[orbit.id] ?? 'Discovered through your listening patterns.'}
          </p>
        )}
      </div>
    </div>
  );
}
