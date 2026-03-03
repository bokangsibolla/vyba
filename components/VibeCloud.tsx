'use client';

import { motion } from 'framer-motion';
import { VibeCluster } from '@/lib/clustering';
import styles from './VibeCloud.module.css';

interface Props {
  vibe: VibeCluster;
  index: number;
  onTap: (vibe: VibeCluster) => void;
}

export default function VibeCloud({ vibe, index, onTap }: Props) {
  const baseSize = Math.max(120, Math.min(200, 80 + vibe.tracks.length * 8));

  return (
    <motion.button
      className={styles.cloud}
      onClick={() => onTap(vibe)}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{
        delay: index * 0.12,
        duration: 0.5,
        ease: [0.2, 0.8, 0.2, 1],
      }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.97 }}
      style={{
        width: baseSize,
        height: baseSize,
        background: `radial-gradient(circle at 30% 30%, ${vibe.color.from}, ${vibe.color.to})`,
      }}
    >
      <span className={styles.label}>{vibe.label}</span>
      <span className={styles.count}>{vibe.tracks.length} tracks</span>
    </motion.button>
  );
}
