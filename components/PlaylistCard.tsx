'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DiscoveryOrbit } from '@/lib/engine/types';
import { sectionColors } from '@/lib/tokens';
import styles from './PlaylistCard.module.css';

interface Props {
  orbit: DiscoveryOrbit;
  savedUrl?: string;
}

function AlbumMosaic({ orbit }: { orbit: DiscoveryOrbit }) {
  const images = orbit.tracks
    .map((t) => t.imageUrl)
    .filter(Boolean)
    .slice(0, 4);

  return (
    <div className={styles.mosaic}>
      {images.map((url, i) => (
        <img key={i} src={url} alt="" className={styles.mosaicImg} />
      ))}
      {Array.from({ length: Math.max(0, 4 - images.length) }).map((_, i) => (
        <div key={`ph-${i}`} className={styles.mosaicPlaceholder} />
      ))}
    </div>
  );
}

export default function PlaylistCard({ orbit, savedUrl }: Props) {
  const [expanded, setExpanded] = useState(false);
  const section = sectionColors[orbit.id as keyof typeof sectionColors] ?? sectionColors.roots;

  return (
    <div className={styles.card}>
      <div
        className={styles.sectionBar}
        style={{ background: section.bg, color: section.accent }}
      >
        <span className={styles.sectionLabel}>{section.label}</span>
        <span className={styles.sectionCount}>{orbit.tracks.length} tracks</span>
      </div>

      <div className={styles.cardHeader} onClick={() => setExpanded(!expanded)}>
        <AlbumMosaic orbit={orbit} />
        <div className={styles.headerInfo}>
          <div className={styles.orbitTagline}>{orbit.description}</div>
        </div>
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
                  href={track.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.trackRow}
                >
                  <span className={styles.trackNum}>{String(i + 1).padStart(2, '0')}</span>
                  {track.imageUrl && (
                    <img
                      src={track.imageUrl}
                      alt=""
                      className={styles.trackImg}
                    />
                  )}
                  <div className={styles.trackInfo}>
                    <span className={styles.trackName}>{track.name}</span>
                    <span className={styles.trackArtist}>
                      {track.artist}
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
