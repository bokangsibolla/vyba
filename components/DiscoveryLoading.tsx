'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import styles from './DiscoveryLoading.module.css';
import { SignalProgress } from '@/lib/engine/types';

const messages = [
  'Reading your music...',
  'Finding artists you\'ll love...',
  'Building your playlists...',
  'Almost there...',
];

interface Props {
  progress?: SignalProgress[];
}

export default function DiscoveryLoading({ progress }: Props) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex(prev => (prev + 1) % messages.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Calculate progress based on steps completed
  const doneCount = progress?.filter(p => p.status === 'done').length ?? 0;
  const totalSteps = Math.max(progress?.length ?? 4, 4);
  const percent = Math.min((doneCount / totalSteps) * 100, 100);

  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div className={styles.container}>
      <div className={styles.ringWrapper}>
        <svg width="88" height="88" viewBox="0 0 88 88" className={styles.ring}>
          <circle
            cx="44"
            cy="44"
            r={radius}
            fill="none"
            stroke="#2E2924"
            strokeWidth="3"
          />
          <motion.circle
            cx="44"
            cy="44"
            r={radius}
            fill="none"
            stroke="#E8622B"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={circumference}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
          />
        </svg>
        <span className={styles.logo}>vyba</span>
      </div>
      <AnimatePresence mode="wait">
        <motion.p
          key={messages[index]}
          className={styles.subtitle}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.4 }}
        >
          {messages[index]}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
