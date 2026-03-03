'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DiscoveryOrbit } from '@/lib/engine/types';
import styles from './PlaylistCard.module.css';

interface Props {
  orbit: DiscoveryOrbit;
  savedUrl?: string;
}

function AlbumMosaic({ orbit }: { orbit: DiscoveryOrbit }) {
  const images = orbit.tracks
    .map((t) => t.album.images[0]?.url)
    .filter(Boolean)
    .slice(0, 4);

  return (
    <div
      className={styles.mosaic}
      style={{ background: `linear-gradient(135deg, ${orbit.color.from}, ${orbit.color.to})` }}
    >
      {images.map((url, i) => (
        <img key={i} src={url} alt="" className={styles.mosaicImg} />
      ))}
      {Array.from({ length: Math.max(0, 4 - images.length) }).map((_, i) => (
        <div
          key={`ph-${i}`}
          className={styles.mosaicPlaceholder}
          style={{ background: `linear-gradient(135deg, ${orbit.color.from}, ${orbit.color.to})` }}
        />
      ))}
    </div>
  );
}

export default function PlaylistCard({ orbit, savedUrl }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader} onClick={() => setExpanded(!expanded)}>
        <AlbumMosaic orbit={orbit} />
        <div className={styles.headerInfo}>
          <div className={styles.orbitLabel}>{orbit.label}</div>
          <div className={styles.orbitDesc}>{orbit.description}</div>
        </div>
        <span className={styles.trackCount}>{orbit.tracks.length}</span>
        <span className={`${styles.expandIcon} ${expanded ? styles.expandIconOpen : ''}`}>&#9654;</span>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div className={styles.trackList}>
              {orbit.tracks.map((track, i) => (
                <a
                  key={track.id}
                  href={track.external_urls.spotify}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.trackRow}
                >
                  <span className={styles.trackNum}>{i + 1}</span>
                  {track.album.images.length > 0 && (
                    <img
                      src={track.album.images[track.album.images.length - 1]?.url}
                      alt=""
                      className={styles.trackImg}
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
          </motion.div>
        )}
      </AnimatePresence>

      {savedUrl && (
        <div className={styles.savedBanner}>
          <span className={styles.checkmark}>&#10003;</span>
          <a href={savedUrl} target="_blank" rel="noopener noreferrer" className={styles.openLink}>
            Open in Spotify
          </a>
        </div>
      )}
    </div>
  );
}
