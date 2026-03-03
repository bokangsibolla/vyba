'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredToken, logout } from '@/lib/spotify/auth';
import { getAllTopTracksWithGenres } from '@/lib/spotify/api';
import { buildVibeMap, VibeCluster } from '@/lib/clustering';
import OrbitMap from '@/components/OrbitMap';
import LoadingState from '@/components/LoadingState';
import GeneratePlaylist from '@/components/GeneratePlaylist';
import Logo from '@/components/Logo';
import styles from './page.module.css';

export default function OrbitPage() {
  const router = useRouter();
  const [vibes, setVibes] = useState<VibeCluster[] | null>(null);
  const [selectedVibe, setSelectedVibe] = useState<VibeCluster | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetched = useRef(false);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;

    const token = getStoredToken();
    if (!token) {
      router.replace('/');
      return;
    }

    getAllTopTracksWithGenres(token)
      .then((tracks) => {
        if (tracks.length === 0) {
          setError('No listening data found. Listen to more music on Spotify and try again.');
          setIsLoading(false);
          return;
        }
        const clusters = buildVibeMap(tracks);
        setVibes(clusters);
        setIsLoading(false);
      })
      .catch((e) => {
        setError(e.message || 'Failed to load your music data');
        setIsLoading(false);
      });
  }, [router]);

  if (error) {
    return (
      <main className={styles.main}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '80dvh', gap: 16, textAlign: 'center' }}>
          <Logo size={28} />
          <p style={{ fontSize: 16, fontWeight: 600, color: '#1A1A1A' }}>Something went wrong</p>
          <p style={{ fontSize: 14, color: '#8A8A8A', maxWidth: 300 }}>{error}</p>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <button
              onClick={() => { fetched.current = false; setError(null); setIsLoading(true); }}
              style={{
                padding: '12px 24px',
                background: '#1A1A1A',
                color: '#fff',
                border: 'none',
                borderRadius: 9999,
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
            <button
              onClick={() => { logout(); router.replace('/'); }}
              style={{
                padding: '12px 24px',
                background: 'none',
                color: '#8A8A8A',
                border: '1px solid #EBEBEB',
                borderRadius: 9999,
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Log out
            </button>
          </div>
        </div>
      </main>
    );
  }

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
        <GeneratePlaylist vibe={selectedVibe} />
      </main>
    );
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Logo size={28} />
        <p className={styles.subtitle}>your orbit map</p>
        <div className={styles.headerRight}>
          <button className={styles.logoutBtn} onClick={() => { logout(); router.replace('/'); }}>Log out</button>
        </div>
      </header>
      <OrbitMap vibes={vibes} onSelectVibe={setSelectedVibe} />
      <footer className={styles.footer}>
        <p className={styles.footerText}>vyba.vercel.app</p>
      </footer>
    </main>
  );
}
