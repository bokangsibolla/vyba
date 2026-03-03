'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { exchangeCodeForToken, storeToken } from '@/lib/spotify/auth';

function CallbackHandler() {
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
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100dvh' }}>
      <p style={{ fontFamily: "'Space Grotesk', sans-serif", color: '#8A8A8A' }}>
        Connecting your Spotify...
      </p>
    </div>
  );
}

export default function Callback() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100dvh' }}>
        <p style={{ fontFamily: "'Space Grotesk', sans-serif", color: '#8A8A8A' }}>
          Connecting your Spotify...
        </p>
      </div>
    }>
      <CallbackHandler />
    </Suspense>
  );
}
