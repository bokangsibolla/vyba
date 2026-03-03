'use client';

import { useState } from 'react';
import { getStoredToken } from '@/lib/spotify/auth';
import { createPlaylist } from '@/lib/spotify/api';
import { DiscoveryOrbit } from '@/lib/engine/types';
import styles from './SavePlaylist.module.css';

interface Props {
  orbit: DiscoveryOrbit;
}

export default function SavePlaylist({ orbit }: Props) {
  const [isSaving, setIsSaving] = useState(false);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const token = getStoredToken();
    if (!token || orbit.tracks.length === 0) return;

    setIsSaving(true);
    setError(null);
    try {
      const url = await createPlaylist(
        token,
        `${orbit.label} — vyba`,
        `Discovered by Vyba from your "${orbit.label}" orbit. ${orbit.description}`,
        orbit.tracks.map((t) => t.uri)
      );
      setSavedUrl(url);
    } catch {
      setError('Failed to save playlist.');
    } finally {
      setIsSaving(false);
    }
  };

  if (orbit.tracks.length === 0) return null;

  return (
    <div className={styles.container}>
      {savedUrl ? (
        <a
          href={savedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.openLink}
        >
          Open in Spotify
        </a>
      ) : (
        <button className={styles.saveBtn} onClick={save} disabled={isSaving}>
          {isSaving ? 'Saving...' : `Save ${orbit.tracks.length} tracks to Spotify`}
        </button>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
