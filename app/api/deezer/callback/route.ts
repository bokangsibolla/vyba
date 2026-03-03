import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  if (!code) {
    return NextResponse.redirect(new URL('/?error=no_code', req.url));
  }

  const res = await fetch(
    `https://connect.deezer.com/oauth/access_token.php?` +
    `app_id=${process.env.NEXT_PUBLIC_DEEZER_APP_ID}` +
    `&secret=${process.env.DEEZER_SECRET}` +
    `&code=${code}` +
    `&output=json`
  );

  const data = await res.json();

  if (data.access_token) {
    return NextResponse.redirect(
      new URL(`/callback/deezer?token=${data.access_token}`, req.url)
    );
  }

  return NextResponse.redirect(new URL('/?error=deezer_auth_failed', req.url));
}
