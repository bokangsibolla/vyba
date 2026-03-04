import { NextResponse } from 'next/server';

interface TrackInfo {
  name: string;
  artist: string;
  url?: string;
}

interface PlaylistSection {
  label: string;
  spotifyUrl: string;
  trackCount: number;
  tracks: TrackInfo[];
}

interface SendDigRequest {
  email: string;
  displayName: string;
  playlists: PlaylistSection[];
}

const sectionBgs: Record<string, { bg: string; accent: string }> = {
  ROOTS:       { bg: '#F5EDE4', accent: '#8B6914' },
  EDGES:       { bg: '#E8F0E4', accent: '#3D6B2E' },
  CROWD:       { bg: '#FCE8D8', accent: '#B5541A' },
  BLINDSPOT:   { bg: '#E4ECF5', accent: '#2E4A6B' },
  'DEEP WORK': { bg: '#EDEBE8', accent: '#555555' },
  WILDCARD:    { bg: '#F5E4EE', accent: '#8B1454' },
};

function buildEmailHtml(name: string, playlists: PlaylistSection[]): string {
  const totalTracks = playlists.reduce((s, p) => s + p.trackCount, 0);

  const sections = playlists.map((pl) => {
    const colors = sectionBgs[pl.label] ?? { bg: '#F0EBE3', accent: '#666' };

    const trackRows = pl.tracks.map((t, i) => {
      const trackLink = t.url
        ? `<a href="${t.url}" style="text-decoration:none;color:inherit;">`
        : '';
      const trackLinkEnd = t.url ? '</a>' : '';

      return `<tr>
        <td style="padding:6px 8px 6px 0;font-family:Courier,monospace;font-size:11px;color:#bbb;vertical-align:top;">${String(i + 1).padStart(2, '0')}</td>
        <td style="padding:6px 0;">
          ${trackLink}
          <span style="font-family:Arial,sans-serif;font-size:13px;color:#111;">${t.name}</span><br/>
          <span style="font-family:Arial,sans-serif;font-size:11px;color:#999;">${t.artist}</span>
          ${trackLinkEnd}
        </td>
        ${t.url ? `<td style="padding:6px 0 6px 8px;vertical-align:middle;">
          <a href="${t.url}" style="font-family:Courier,monospace;font-size:10px;color:#1DB954;text-decoration:none;white-space:nowrap;">&#9654; PLAY</a>
        </td>` : ''}
      </tr>`;
    }).join('');

    return `
      <div style="border:2px solid #E5DDD0;border-radius:12px;overflow:hidden;margin-bottom:20px;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="background:${colors.bg};padding:10px 16px;">
              <span style="font-family:Courier,monospace;font-size:11px;font-weight:700;letter-spacing:0.1em;color:${colors.accent};text-transform:uppercase;">${pl.label}</span>
              <span style="font-family:Courier,monospace;font-size:11px;color:${colors.accent};float:right;">${pl.trackCount} tracks</span>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 16px;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%">${trackRows}</table>
            </td>
          </tr>
          ${pl.spotifyUrl ? `<tr>
            <td style="padding:0 16px 14px;">
              <a href="${pl.spotifyUrl}" style="display:inline-block;font-family:Courier,monospace;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#FFFDF5;background:#111;padding:10px 20px;border-radius:6px;text-decoration:none;">Open playlist in Spotify</a>
            </td>
          </tr>` : ''}
        </table>
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#FFFDF5;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;font-family:Arial,sans-serif;">
    <h1 style="font-family:Courier,monospace;font-size:24px;font-weight:700;letter-spacing:0.08em;color:#111;margin:0;">VYBA</h1>
    <p style="font-family:Courier,monospace;font-size:11px;color:#FF4D00;letter-spacing:0.1em;text-transform:uppercase;margin:6px 0 0;">Your Daily Dig</p>
    <hr style="border:none;border-top:2px solid #111;margin:16px 0 24px;" />

    <h2 style="font-family:Georgia,serif;font-size:26px;font-weight:400;color:#111;margin:0 0 8px;line-height:1.2;">
      ${totalTracks} tracks across ${playlists.length} sections.<br/>All yours, ${name}.
    </h2>
    <p style="font-family:Courier,monospace;font-size:12px;color:#999;letter-spacing:0.04em;margin:0 0 32px;">
      Tap any track to open it in Spotify.
    </p>

    ${sections}

    <hr style="border:none;border-top:1px solid #E5DDD0;margin:24px 0;" />
    <p style="font-family:Courier,monospace;font-size:11px;color:#bbb;text-align:center;letter-spacing:0.04em;">
      vyba · read only · never posts anything
    </p>
  </div>
</body>
</html>`;
}

export async function POST(request: Request) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) {
    return NextResponse.json({ error: 'Email not configured' }, { status: 500 });
  }

  const body: SendDigRequest = await request.json();
  const html = buildEmailHtml(body.displayName || 'friend', body.playlists);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'VYBA <onboarding@resend.dev>',
      to: body.email,
      subject: 'Your first dig is ready',
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: err }, { status: res.status });
  }

  return NextResponse.json({ sent: true });
}
