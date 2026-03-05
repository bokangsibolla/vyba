'use client';

import { motion } from 'framer-motion';
import styles from './DiscoveryLoading.module.css';
import { SignalProgress } from '@/lib/engine/types';

interface Props {
  progress?: SignalProgress[];
}

export default function DiscoveryLoading({ progress }: Props) {
  const currentStep = progress?.find(p => p.status === 'loading');
  const displayLabel = currentStep?.label ?? 'Listening to your library...';

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
        key={displayLabel}
        className={styles.subtitle}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {displayLabel}
      </motion.p>
      {progress && progress.length > 0 && (
        <div className={styles.steps}>
          {progress.map((step, i) => (
            <div key={i} className={styles.step}>
              <span className={styles.stepIcon}>
                {step.status === 'done' ? '✓' : step.status === 'loading' ? '·' : step.status === 'error' ? '✗' : '○'}
              </span>
              <span className={styles.stepLabel}>{step.label}</span>
              {step.detail && (
                <span className={styles.stepDetail}> — {step.detail}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
