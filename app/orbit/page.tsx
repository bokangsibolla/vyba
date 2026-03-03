'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredToken } from '@/lib/spotify/auth';
import { getAllTopTracksWithFeatures } from '@/lib/spotify/api';
import { buildVibeMap, VibeCluster } from '@/lib/clustering';
import OrbitMap from '@/components/OrbitMap';
import LoadingState from '@/components/LoadingState';
import Logo from '@/components/Logo';
import styles from './page.module.css';

export default function OrbitPage() {
  const router = useRouter();
  const [vibes, setVibes] = useState<VibeCluster[] | null>(null);
  const [selectedVibe, setSelectedVibe] = useState<VibeCluster | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      router.replace('/');
      return;
    }

    getAllTopTracksWithFeatures(token)
      .then((tracks) => {
        const k = Math.min(6, Math.max(3, Math.floor(tracks.length / 15)));
        const clusters = buildVibeMap(tracks, k);
        setVibes(clusters);
        setIsLoading(false);
      })
      .catch(() => {
        router.replace('/');
      });
  }, [router]);

  if (isLoading || !vibes) return <LoadingState />;

  if (selectedVibe) {
    return (
      <main className={styles.main}>
        <header className={styles.detailHeader}>
          <button className={styles.back} onClick={() => setSelectedVibe(null)}>&larr;</button>
          <div>
            <h1 className={styles.vibeTitle}>{selectedVibe.label}</h1>
            <p className={styles.vibeDesc}>{selectedVibe.description}</p>
          </div>
        </header>
        <div className={styles.trackList}>
          {selectedVibe.tracks.map((track) => (
            <a
              key={track.id}
              href={track.external_urls.spotify}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.trackRow}
            >
              <img
                src={track.album.images[track.album.images.length - 1]?.url}
                alt=""
                className={styles.trackImg}
                width={48}
                height={48}
              />
              <div className={styles.trackInfo}>
                <span className={styles.trackName}>{track.name}</span>
                <span className={styles.trackArtist}>
                  {track.artists.map((a) => a.name).join(', ')}
                </span>
              </div>
            </a>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Logo size={28} />
        <p className={styles.subtitle}>your orbit map</p>
      </header>
      <OrbitMap vibes={vibes} onSelectVibe={setSelectedVibe} />
    </main>
  );
}
