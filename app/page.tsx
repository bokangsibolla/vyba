'use client';

import { useRouter } from 'next/navigation';
import { getStoredToken, redirectToSpotifyAuth } from '@/lib/spotify/auth';
import { getDeezerToken } from '@/lib/deezer/auth';
import Logo from '@/components/Logo';
import styles from './page.module.css';

export default function Home() {
  const router = useRouter();
  const hasToken = typeof window !== 'undefined' && !!(getStoredToken() || getDeezerToken());

  return (
    <main className={styles.main}>
      <div className={styles.content}>
        <Logo size={28} />
        <h1 className={styles.tagline}>
          Fresh music, every morning.
        </h1>

        {hasToken ? (
          <button className={styles.cta} onClick={() => router.push('/orbit')}>
            Open your orbits
          </button>
        ) : (
          <button className={styles.cta} onClick={redirectToSpotifyAuth}>
            Connect Spotify
          </button>
        )}

        {!hasToken && (
          <p className={styles.note}>
            Read-only. We never post anything.
          </p>
        )}
      </div>
    </main>
  );
}
