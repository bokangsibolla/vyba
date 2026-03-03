'use client';

import { DiscoveryOrbit, OrbitId } from '@/lib/engine/types';
import OrbitCloud from './OrbitCloud';
import styles from './OrbitMap.module.css';

interface Props {
  orbits: DiscoveryOrbit[];
  onSelectOrbit: (orbit: DiscoveryOrbit) => void;
}

const SLOT_ORDER: OrbitId[] = ['roots', 'edges', 'crowd', 'blindspot'];
const SLOT_CLASSES: Record<OrbitId, string> = {
  roots: styles.slotTop,
  edges: styles.slotLeft,
  crowd: styles.slotRight,
  blindspot: styles.slotBottom,
};

export default function OrbitMap({ orbits, onSelectOrbit }: Props) {
  const orbitMap = new Map(orbits.map((o) => [o.id, o]));

  return (
    <div className={styles.map}>
      <div className={styles.diamond}>
        {SLOT_ORDER.map((id, i) => {
          const orbit = orbitMap.get(id);
          return (
            <div key={id} className={`${styles.orbitSlot} ${SLOT_CLASSES[id]}`}>
              {orbit && orbit.status === 'ready' ? (
                <OrbitCloud orbit={orbit} index={i} onTap={onSelectOrbit} />
              ) : (
                <div className={styles.emptySlot}>
                  {orbit?.status === 'error' ? 'unavailable' : ''}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
