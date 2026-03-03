'use client';

import { motion } from 'framer-motion';

export default function LoadingState() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100dvh',
      gap: 16,
    }}>
      <motion.div
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: 24,
          fontWeight: 700,
          color: '#1A1A1A',
          letterSpacing: '-0.02em',
        }}
      >
        vyba
      </motion.div>
      <p style={{
        fontFamily: "'Space Grotesk', sans-serif",
        fontSize: 14,
        color: '#8A8A8A',
      }}>
        mapping your sound...
      </p>
    </div>
  );
}
