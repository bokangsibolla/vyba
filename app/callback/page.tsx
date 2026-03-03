'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { exchangeCodeForToken, storeToken } from '@/lib/spotify/auth';

export default function Callback() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code) {
      router.replace('/');
      return;
    }

    exchangeCodeForToken(code)
      .then((token) => {
        storeToken(token);
        router.replace('/orbit');
      })
      .catch(() => {
        router.replace('/');
      });
  }, [searchParams, router]);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <p style={{ fontFamily: "'Space Grotesk', sans-serif", color: '#8A8A8A' }}>
        Connecting your Spotify...
      </p>
    </div>
  );
}
