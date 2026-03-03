const CLIENT_ID = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID!;
const REDIRECT_URI = process.env.NEXT_PUBLIC_REDIRECT_URI!;
const SCOPES = [
  'user-top-read',
  'user-read-recently-played',
  'user-read-email',
  'playlist-modify-public',
  'playlist-modify-private',
].join(' ');

function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (v) => chars[v % chars.length]).join('');
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  return crypto.subtle.digest('SHA-256', encoder.encode(plain));
}

function base64urlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const str = String.fromCharCode(...bytes);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function redirectToSpotifyAuth(): Promise<void> {
  const codeVerifier = generateRandomString(64);
  const hashed = await sha256(codeVerifier);
  const codeChallenge = base64urlEncode(hashed);

  sessionStorage.setItem('spotify_code_verifier', codeVerifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

export async function exchangeCodeForToken(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const codeVerifier = sessionStorage.getItem('spotify_code_verifier');
  if (!codeVerifier) throw new Error('No code verifier found');

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });

  if (!res.ok) throw new Error('Token exchange failed');
  return res.json();
}

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  const data = localStorage.getItem('vyba_token');
  if (!data) return null;

  const parsed = JSON.parse(data);
  const now = Date.now();
  const expiresAt = parsed.timestamp + parsed.expires_in * 1000;

  if (now >= expiresAt) {
    localStorage.removeItem('vyba_token');
    return null;
  }

  return parsed.access_token;
}

export function storeToken(token: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}): void {
  localStorage.setItem('vyba_token', JSON.stringify({ ...token, timestamp: Date.now() }));
}

export function logout(): void {
  localStorage.removeItem('vyba_token');
  sessionStorage.removeItem('spotify_code_verifier');
}
