'use client';

import { motion } from 'framer-motion';
import { DiscoveryOrbit } from '@/lib/engine/types';
import styles from './OrbitCloud.module.css';

interface Props {
  orbit: DiscoveryOrbit;
  index: number;
  onTap: (orbit: DiscoveryOrbit) => void;
}

export default function OrbitCloud({ orbit, index, onTap }: Props) {
  const baseSize = Math.max(120, Math.min(180, 100 + orbit.tracks.length * 3));

  return (
    <motion.button
      className={styles.cloud}
      onClick={() => onTap(orbit)}
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
        background: `radial-gradient(circle at 30% 30%, ${orbit.color.from}, ${orbit.color.to})`,
      }}
    >
      <div
        className={styles.confidenceRing}
        style={{
          color: orbit.color.from,
          opacity: orbit.confidence,
        }}
      />
      <span className={styles.label}>{orbit.label}</span>
      <span className={styles.count}>{orbit.tracks.length} discoveries</span>
    </motion.button>
  );
}
