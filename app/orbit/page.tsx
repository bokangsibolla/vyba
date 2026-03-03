'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredToken, logout } from '@/lib/spotify/auth';
import { createPlaylist } from '@/lib/spotify/api';
import { runDiscoveryEngine } from '@/lib/engine';
import { EngineState } from '@/lib/engine/types';
import DiscoveryLoading from '@/components/DiscoveryLoading';
import PlaylistCard from '@/components/PlaylistCard';
import Logo from '@/components/Logo';
import styles from './page.module.css';

export default function OrbitPage() {
  const router = useRouter();
  const [engineState, setEngineState] = useState<EngineState>({
    orbits: [],
    isLoading: true,
    progress: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [savedUrls, setSavedUrls] = useState<Record<string, string>>({});
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [allSaved, setAllSaved] = useState(false);
  const fetched = useRef(false);

  const handleProgress = useCallback((state: EngineState) => {
    setEngineState(state);
    if (state.error) setError(state.error);
  }, []);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;

    const token = getStoredToken();
    if (!token) {
      router.replace('/');
      return;
    }

    runDiscoveryEngine(token, handleProgress)
      .then((orbits) => {
        if (orbits.length === 0) {
          setError('No listening data found. Listen to more music on Spotify and try again.');
        }
      })
      .catch((e) => {
        setError(e.message || 'Failed to load your music data');
      });
  }, [router, handleProgress]);

  const saveAll = async () => {
    const token = getStoredToken();
    if (!token) return;

    const orbits = engineState.orbits.filter((o) => o.status === 'ready' && o.tracks.length > 0);
    if (orbits.length === 0) return;

    setIsSavingAll(true);
    const urls: Record<string, string> = { ...savedUrls };

    for (const orbit of orbits) {
      if (urls[orbit.id]) continue;
      try {
        const url = await createPlaylist(
          token,
          `${orbit.label} — vyba`,
          orbit.description,
          orbit.tracks.map((t) => t.uri)
        );
        urls[orbit.id] = url;
        setSavedUrls({ ...urls });
      } catch {
        // continue with others
      }
    }

    setSavedUrls(urls);
    setIsSavingAll(false);
    setAllSaved(true);
  };

  const readyOrbits = engineState.orbits.filter((o) => o.status === 'ready' && o.tracks.length > 0);
  const totalTracks = readyOrbits.reduce((sum, o) => sum + o.tracks.length, 0);

  if (error) {
    return (
      <main className={styles.main}>
        <div className={styles.errorContainer}>
          <Logo size={28} />
          <p className={styles.errorTitle}>Something went wrong</p>
          <p className={styles.errorMessage}>{error}</p>
          <div className={styles.errorActions}>
            <button
              className={styles.retryBtn}
              onClick={() => {
                fetched.current = false;
                setError(null);
                setEngineState({ orbits: [], isLoading: true, progress: [] });
              }}
            >
              Retry
            </button>
            <button
              className={styles.logoutBtnAlt}
              onClick={() => { logout(); router.replace('/'); }}
            >
              Log out
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (engineState.isLoading) {
    return <DiscoveryLoading progress={engineState.progress} />;
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Logo size={24} />
          <span className={styles.issueBadge}>
            Issue #{String(Math.floor(Date.now() / 86400000) % 1000).padStart(3, '0')} — Your Daily Dig
          </span>
          <p className={styles.subtitle}>
            {readyOrbits.length} section{readyOrbits.length !== 1 ? 's' : ''}, {totalTracks} tracks
          </p>
        </div>
        <button className={styles.logoutBtn} onClick={() => { logout(); router.replace('/'); }}>
          Log out
        </button>
      </header>

      <div className={styles.cards}>
        {readyOrbits.map((orbit) => (
          <PlaylistCard key={orbit.id} orbit={orbit} savedUrl={savedUrls[orbit.id]} />
        ))}
      </div>

      <div className={styles.saveSection}>
        {allSaved ? (
          <p className={styles.savedMessage}>
            &#10003; {Object.keys(savedUrls).length} playlist{Object.keys(savedUrls).length !== 1 ? 's' : ''} added to your Spotify
          </p>
        ) : (
          <button
            className={styles.saveAllBtn}
            onClick={saveAll}
            disabled={isSavingAll || readyOrbits.length === 0}
          >
            {isSavingAll ? 'Saving...' : 'Add all to Spotify'}
          </button>
        )}
      </div>

      <footer className={styles.footer}>
        <p className={styles.footerText}>vyba.vercel.app</p>
      </footer>
    </main>
  );
}
