'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import styles from './DiscoveryLoading.module.css';

const messages = [
  'Listening to your library...',
  'Finding the good stuff...',
  'Digging deeper...',
  'Almost there...',
];

export default function DiscoveryLoading() {
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIndex((i) => (i + 1) % messages.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className={styles.container}>
      <motion.div
        className={styles.logo}
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      >
        vyba
      </motion.div>
      <motion.p
        key={msgIndex}
        className={styles.subtitle}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {messages[msgIndex]}
      </motion.p>
    </div>
  );
}
