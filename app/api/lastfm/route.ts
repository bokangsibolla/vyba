import { NextRequest, NextResponse } from 'next/server';

const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0/';
const API_KEY = process.env.LASTFM_API_KEY;

export async function GET(req: NextRequest) {
  if (!API_KEY) {
    return NextResponse.json({ error: 'Last.fm API key not configured' }, { status: 500 });
  }

  const artist = req.nextUrl.searchParams.get('artist');
  if (!artist) {
    return NextResponse.json({ error: 'Missing artist param' }, { status: 400 });
  }

  const method = req.nextUrl.searchParams.get('method') ?? 'artist.getSimilar';
  const limit = req.nextUrl.searchParams.get('limit') ?? '30';

  const url = new URL(LASTFM_BASE);
  url.searchParams.set('method', method);
  url.searchParams.set('artist', artist);
  url.searchParams.set('limit', limit);
  url.searchParams.set('api_key', API_KEY);
  url.searchParams.set('format', 'json');

  try {
    const res = await fetch(url.toString());
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: 'Last.fm request failed' }, { status: 502 });
  }
}
