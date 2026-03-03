'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredToken, redirectToSpotifyAuth } from '@/lib/spotify/auth';
import Logo from '@/components/Logo';
import styles from './page.module.css';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    if (getStoredToken()) {
      router.replace('/orbit');
    }
  }, [router]);

  return (
    <main className={styles.main}>
      <div className={styles.content}>
        <Logo size={48} />
        <p className={styles.tagline}>your music taste, visualized</p>
        <p className={styles.sub}>
          See the vibes you gravitate toward. Generate playlists from any orbit.
          No waiting a week.
        </p>
        <button className={styles.connect} onClick={redirectToSpotifyAuth}>
          Connect Spotify
        </button>
        <p className={styles.note}>
          We only read your listening history. Nothing is posted or shared.
        </p>
      </div>
    </main>
  );
}
