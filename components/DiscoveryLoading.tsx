'use client';

import { motion } from 'framer-motion';
import { SignalProgress } from '@/lib/engine/types';
import styles from './DiscoveryLoading.module.css';

interface Props {
  progress: SignalProgress[];
}

function StepIcon({ status }: { status: SignalProgress['status'] }) {
  if (status === 'done') return <span className={styles.icon}>&#10003;</span>;
  if (status === 'loading') return <span className={styles.icon}><span className={styles.spinner} /></span>;
  if (status === 'error') return <span className={styles.icon}>&#10007;</span>;
  return <span className={styles.icon}><span className={styles.dot} /></span>;
}

export default function DiscoveryLoading({ progress }: Props) {
  return (
    <div className={styles.container}>
      <motion.div
        className={styles.logo}
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      >
        vyba
      </motion.div>
      <p className={styles.subtitle}>mapping your universe...</p>
      <div className={styles.steps}>
        {progress.map((step, i) => (
          <motion.div
            key={step.label}
            className={`${styles.step} ${step.status === 'done' ? styles.stepDone : ''} ${step.status === 'error' ? styles.stepError : ''}`}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.15, duration: 0.3 }}
          >
            <StepIcon status={step.status} />
            <span className={styles.label}>{step.label}</span>
            {step.detail && <span className={styles.detail}>{step.detail}</span>}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
