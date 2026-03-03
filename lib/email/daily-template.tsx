import {
  Html, Head, Body, Container, Section, Text, Img, Link, Hr, Row, Column,
} from '@react-email/components';

interface DailyEmailProps {
  issueNumber: number;
  date: string;
  displayName: string;
  djIntro: string;
  sections: {
    label: string;
    tagline: string;
    trackCount: number;
    durationMin: number;
    tracks: {
      name: string;
      artist: string;
      imageUrl: string;
      externalUrl: string;
    }[];
    playlistUrl?: string;
  }[];
  djTeaser: string;
  webViewUrl: string;
}

export default function DailyVybaEmail({
  issueNumber,
  date,
  displayName,
  djIntro,
  sections,
  djTeaser,
  webViewUrl,
}: DailyEmailProps) {
  return (
    <Html>
      <Head>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Inter:wght@400;500;600&display=swap');
          body { margin: 0; padding: 0; }
        `}</style>
      </Head>
      <Body style={{ backgroundColor: '#FFFDF5', fontFamily: "'Inter', Arial, sans-serif" }}>
        <Container style={{ maxWidth: 560, margin: '0 auto', padding: '32px 16px' }}>
          {/* Header */}
          <Section>
            <Text style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: 24,
              fontWeight: 700,
              color: '#111111',
              letterSpacing: '0.08em',
              margin: 0,
            }}>
              VYBA
            </Text>
            <Text style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: 11,
              fontWeight: 700,
              color: '#FF4D00',
              letterSpacing: '0.1em',
              textTransform: 'uppercase' as const,
              margin: '4px 0 0',
            }}>
              Issue #{String(issueNumber).padStart(3, '0')} --- {date}
            </Text>
          </Section>

          <Hr style={{ borderColor: '#111111', borderWidth: 2, margin: '16px 0' }} />

          {/* DJ Intro */}
          <Section>
            <Text style={{
              fontFamily: "'Inter', Arial, sans-serif",
              fontSize: 15,
              color: '#111111',
              lineHeight: '1.6',
              margin: '0 0 24px',
            }}>
              {djIntro}
            </Text>
          </Section>

          {/* Sections */}
          {sections.map((section, i) => (
            <Section key={i} style={{ marginBottom: 24 }}>
              <div style={{
                backgroundColor: '#F5EDE4',
                padding: '6px 12px',
                marginBottom: 12,
              }}>
                <Text style={{
                  fontFamily: "'Space Mono', monospace",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  color: '#111111',
                  margin: 0,
                  textTransform: 'uppercase' as const,
                }}>
                  {section.label}
                </Text>
                <Text style={{
                  fontFamily: "'Inter', Arial, sans-serif",
                  fontSize: 12,
                  color: '#6B6B6B',
                  margin: '2px 0 0',
                }}>
                  {section.tagline} --- {section.trackCount} tracks, ~{section.durationMin} min
                </Text>
              </div>

              {/* Track list (first 5 shown) */}
              {section.tracks.slice(0, 5).map((track, j) => (
                <Row key={j} style={{ marginBottom: 8 }}>
                  <Column style={{ width: 22 }}>
                    <Text style={{
                      fontFamily: "'Space Mono', monospace",
                      fontSize: 11,
                      color: '#B5AFA5',
                      margin: 0,
                      textAlign: 'right' as const,
                    }}>
                      {String(j + 1).padStart(2, '0')}
                    </Text>
                  </Column>
                  <Column style={{ width: 40, paddingLeft: 8 }}>
                    {track.imageUrl && (
                      <Img src={track.imageUrl} width={36} height={36} alt="" style={{ borderRadius: 2 }} />
                    )}
                  </Column>
                  <Column style={{ paddingLeft: 8 }}>
                    <Link href={track.externalUrl} style={{ textDecoration: 'none' }}>
                      <Text style={{
                        fontFamily: "'Inter', Arial, sans-serif",
                        fontSize: 13,
                        fontWeight: 500,
                        color: '#111111',
                        margin: 0,
                      }}>
                        {track.name}
                      </Text>
                      <Text style={{
                        fontFamily: "'Inter', Arial, sans-serif",
                        fontSize: 11,
                        color: '#6B6B6B',
                        margin: '1px 0 0',
                      }}>
                        {track.artist}
                      </Text>
                    </Link>
                  </Column>
                </Row>
              ))}

              {section.tracks.length > 5 && (
                <Text style={{
                  fontFamily: "'Space Mono', monospace",
                  fontSize: 11,
                  color: '#6B6B6B',
                  margin: '8px 0 0',
                }}>
                  + {section.tracks.length - 5} more tracks
                </Text>
              )}

              {section.playlistUrl && (
                <Link href={section.playlistUrl} style={{
                  display: 'inline-block',
                  fontFamily: "'Space Mono', monospace",
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#FFFDF5',
                  backgroundColor: '#111111',
                  padding: '8px 16px',
                  borderRadius: 4,
                  textDecoration: 'none',
                  marginTop: 8,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase' as const,
                }}>
                  PLAY ON SPOTIFY
                </Link>
              )}
            </Section>
          ))}

          <Hr style={{ borderColor: '#E5DDD0', margin: '24px 0' }} />

          {/* DJ Teaser */}
          <Section>
            <Text style={{
              fontFamily: "'Inter', Arial, sans-serif",
              fontSize: 14,
              color: '#6B6B6B',
              lineHeight: '1.5',
              fontStyle: 'italic',
              margin: 0,
            }}>
              {djTeaser}
            </Text>
          </Section>

          <Hr style={{ borderColor: '#E5DDD0', margin: '24px 0' }} />

          {/* Footer */}
          <Section>
            <Text style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: 11,
              color: '#B5AFA5',
              textAlign: 'center' as const,
              margin: 0,
            }}>
              <Link href={webViewUrl} style={{ color: '#6B6B6B' }}>View in browser</Link>
              {' '} --- {' '}
              <Link href="%unsubscribe_url%" style={{ color: '#6B6B6B' }}>Unsubscribe</Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
