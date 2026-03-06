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
          New music every<br />morning at 6am.
        </h1>
        <p className={styles.sub}>
          Connect Spotify. We do the digging.
        </p>

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
          <button className={styles.loginLink} onClick={redirectToSpotifyAuth}>
            Already connected? Log in
          </button>
        )}

        <p className={styles.note}>
          read only · never posts anything
        </p>
      </div>
    </main>
  );
}
