'use client';

import { useRouter } from 'next/navigation';
import { getStoredToken, redirectToSpotifyAuth } from '@/lib/spotify/auth';
import Logo from '@/components/Logo';
import styles from './page.module.css';

export default function Home() {
  const router = useRouter();
  const hasToken = typeof window !== 'undefined' && !!getStoredToken();

  return (
    <main className={styles.main}>
      <div className={styles.content}>
        <Logo size={28} />
        <span className={styles.badge}>Your Daily Dig</span>
        <h1 className={styles.tagline}>
          Good music<br />finds you here.
        </h1>
        <p className={styles.sub}>
          60 songs. Six sections. Every morning at 6am.
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

        <p className={styles.note}>
          read only · never posts anything
        </p>
      </div>
    </main>
  );
}
