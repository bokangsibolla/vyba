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

const sectionInfo: Record<string, { bg: string; accent: string; tagline: string }> = {
  ROOTS:       { bg: '#3A2E1A', accent: '#D4A853', tagline: 'Where your sound was born' },
  EDGES:       { bg: '#1E2E1A', accent: '#7A9B5A', tagline: 'Where your taste is heading' },
  CROWD:       { bg: '#3A2218', accent: '#E8622B', tagline: 'What your people are playing' },
  BLINDSPOT:   { bg: '#1A2A30', accent: '#5A9B9B', tagline: "Important music you've never touched" },
  'DEEP WORK': { bg: '#26252A', accent: '#8A8494', tagline: 'Disappear for 3 hours' },
  WILDCARD:    { bg: '#30192A', accent: '#C45A8A', tagline: 'Completely outside your bubble' },
};

function buildEmailHtml(name: string, playlists: PlaylistSection[]): string {
  const sections = playlists.map((pl) => {
    const colors = sectionInfo[pl.label] ?? { bg: '#2F2A22', accent: '#8A7E6E', tagline: '' };

    const trackRows = pl.tracks.map((t, i) => {
      const trackLink = t.url
        ? `<a href="${t.url}" style="text-decoration:none;color:inherit;">`
        : '';
      const trackLinkEnd = t.url ? '</a>' : '';

      return `<tr>
        <td style="padding:6px 8px 6px 0;font-family:Courier,monospace;font-size:11px;color:#5A5347;vertical-align:top;">${String(i + 1).padStart(2, '0')}</td>
        <td style="padding:6px 0;">
          ${trackLink}
          <span style="font-family:Arial,sans-serif;font-size:13px;color:#F0DFC8;">${t.name}</span><br/>
          <span style="font-family:Arial,sans-serif;font-size:11px;color:#8A7E6E;">${t.artist}</span>
          ${trackLinkEnd}
        </td>
        ${t.url ? `<td style="padding:6px 0 6px 8px;vertical-align:middle;">
          <a href="${t.url}" style="font-family:Courier,monospace;font-size:10px;color:#E8622B;text-decoration:none;white-space:nowrap;">&#9654; PLAY</a>
        </td>` : ''}
      </tr>`;
    }).join('');

    return `
      <div style="border:2px solid #3D362C;border-radius:12px;overflow:hidden;margin-bottom:20px;background:#252119;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="background:${colors.bg};padding:10px 16px;">
              <div>
                <span style="font-family:Courier,monospace;font-size:11px;font-weight:700;letter-spacing:0.1em;color:${colors.accent};text-transform:uppercase;">${pl.label}</span>
                <span style="font-family:Courier,monospace;font-size:11px;color:${colors.accent};float:right;">${pl.trackCount} tracks</span>
              </div>
              ${colors.tagline ? `<div style="font-family:Arial,sans-serif;font-size:12px;color:${colors.accent};opacity:0.6;margin-top:4px;">${colors.tagline}</div>` : ''}
            </td>
          </tr>
          <tr>
            <td style="padding:12px 16px;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%">${trackRows}</table>
            </td>
          </tr>
          ${pl.spotifyUrl ? `<tr>
            <td style="padding:0 16px 14px;">
              <a href="${pl.spotifyUrl}" style="display:inline-block;font-family:Courier,monospace;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#1A1714;background:#E8622B;padding:10px 20px;border-radius:6px;text-decoration:none;">Open playlist</a>
            </td>
          </tr>` : ''}
        </table>
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#1A1714;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;font-family:Arial,sans-serif;">
    <h1 style="font-family:Courier,monospace;font-size:24px;font-weight:700;letter-spacing:0.08em;color:#E8622B;margin:0;">VYBA</h1>
    <p style="font-family:Courier,monospace;font-size:11px;color:#D4A853;letter-spacing:0.1em;text-transform:uppercase;margin:6px 0 0;">Your Daily Dig</p>
    <hr style="border:none;border-top:2px solid #3D362C;margin:16px 0 24px;" />

    <h2 style="font-family:Georgia,serif;font-size:26px;font-weight:400;color:#F0DFC8;margin:0 0 8px;line-height:1.2;">
      Hey ${name}. We dug through your listening history and built you ${playlists.length} playlists.
    </h2>
    <p style="font-family:Courier,monospace;font-size:12px;color:#8A7E6E;letter-spacing:0.04em;margin:0 0 32px;">
      Each one explores a different angle of your taste. Tap any track to play it.
    </p>

    ${sections}

    <hr style="border:none;border-top:1px solid #3D362C;margin:24px 0;" />
    <p style="font-family:Courier,monospace;font-size:11px;color:#5A5347;text-align:center;letter-spacing:0.04em;">
      vyba · read only · never posts anything
    </p>
  </div>
</body>
</html>`;
}

export async function POST(request: Request) {
  const BREVO_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_KEY) {
    return NextResponse.json({ error: 'Email not configured' }, { status: 500 });
  }

  const body: SendDigRequest = await request.json();
  const html = buildEmailHtml(body.displayName || 'friend', body.playlists);

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'VYBA', email: 'sibollabokang@gmail.com' },
      to: [{ email: body.email }],
      subject: `Your first dig — ${body.playlists.length} playlists built from your listening history`,
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: err }, { status: res.status });
  }

  return NextResponse.json({ sent: true });
}
