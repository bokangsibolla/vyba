'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredToken, logout } from '@/lib/spotify/auth';
import Logo from '@/components/Logo';
import styles from './page.module.css';

interface UserInfo {
  email: string;
  displayName: string;
}

export default function AccountPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState<string | null>(null);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      router.replace('/');
      return;
    }

    fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((me) => {
        setUser({
          email: me.email,
          displayName: me.display_name || 'Unknown',
        });
        setLoading(false);
      })
      .catch(() => {
        router.replace('/');
      });
  }, [router]);

  const handleUnsubscribe = async () => {
    if (!user) return;
    if (!confirm('Stop receiving daily emails? You can reconnect anytime.')) return;

    setActionPending('unsubscribe');
    await fetch('/api/account/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email }),
    });
    setActionPending(null);
    alert('Unsubscribed. You will no longer receive daily emails.');
  };

  const handleDelete = async () => {
    if (!user) return;
    if (!confirm('Delete your account? This removes all your data and cannot be undone.')) return;

    setActionPending('delete');
    await fetch('/api/account/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email }),
    });
    logout();
    localStorage.removeItem('vyba_email');
    localStorage.removeItem('vyba_first_dig_sent');
    localStorage.removeItem('vyba_service');
    router.replace('/');
  };

  const handleLogout = () => {
    logout();
    router.replace('/');
  };

  if (loading) {
    return (
      <main className={styles.main}>
        <p className={styles.loading}>Loading...</p>
      </main>
    );
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Logo size={24} />
        <button className={styles.backBtn} onClick={() => router.push('/orbit')}>
          Back
        </button>
      </header>

      <h1 className={styles.title}>Account</h1>

      <div className={styles.section}>
        <p className={styles.label}>Display name</p>
        <p className={styles.value}>{user?.displayName}</p>
      </div>

      <div className={styles.section}>
        <p className={styles.label}>Email</p>
        <p className={styles.value}>{user?.email}</p>
      </div>

      <div className={styles.actions}>
        <button
          className={styles.actionBtn}
          onClick={handleUnsubscribe}
          disabled={actionPending !== null}
        >
          {actionPending === 'unsubscribe' ? 'Unsubscribing...' : 'Unsubscribe from daily emails'}
          <span className={styles.actionBtnDesc}>
            Stop receiving emails. You can reconnect anytime.
          </span>
        </button>

        <button
          className={styles.actionBtn}
          onClick={handleLogout}
        >
          Log out
        </button>

        <button
          className={styles.dangerBtn}
          onClick={handleDelete}
          disabled={actionPending !== null}
        >
          {actionPending === 'delete' ? 'Deleting...' : 'Delete my account'}
          <span className={styles.actionBtnDesc}>
            Permanently remove all your data.
          </span>
        </button>
      </div>
    </main>
  );
}
