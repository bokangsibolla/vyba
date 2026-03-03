'use client';

import { VibeCluster } from '@/lib/clustering';
import VibeCloud from './VibeCloud';
import styles from './OrbitMap.module.css';

interface Props {
  vibes: VibeCluster[];
  onSelectVibe: (vibe: VibeCluster) => void;
}

function getPosition(index: number): { top: string; left: string } {
  const positions = [
    { top: '8%', left: '15%' },
    { top: '5%', left: '55%' },
    { top: '30%', left: '35%' },
    { top: '35%', left: '70%' },
    { top: '55%', left: '10%' },
    { top: '55%', left: '55%' },
    { top: '75%', left: '30%' },
  ];
  return positions[index % positions.length];
}

export default function OrbitMap({ vibes, onSelectVibe }: Props) {
  return (
    <div className={styles.map}>
      {vibes.map((vibe, i) => {
        const pos = getPosition(i);
        return (
          <div key={vibe.id} className={styles.cloudWrapper} style={{ top: pos.top, left: pos.left }}>
            <VibeCloud vibe={vibe} index={i} onTap={onSelectVibe} />
          </div>
        );
      })}
    </div>
  );
}
