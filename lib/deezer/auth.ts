const APP_ID = process.env.NEXT_PUBLIC_DEEZER_APP_ID!;
const REDIRECT_URI = process.env.NEXT_PUBLIC_DEEZER_REDIRECT_URI!;
const PERMS = 'basic_access,email,listening_history,manage_library';

export function redirectToDeezerAuth(): void {
  const params = new URLSearchParams({
    app_id: APP_ID,
    redirect_uri: REDIRECT_URI,
    perms: PERMS,
  });
  window.location.href = `https://connect.deezer.com/oauth/auth.php?${params}`;
}

export function storeDeezerToken(token: string): void {
  localStorage.setItem('vyba_deezer_token', token);
}

export function getDeezerToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('vyba_deezer_token');
}
