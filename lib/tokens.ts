// === Cassette Futurism Design Tokens ===

export const colors = {
  bg: '#1A1714',
  bgCard: '#252119',
  surface: '#2F2A22',
  text: '#F0DFC8',
  textMuted: '#8A7E6E',
  accent: '#E8622B',
  accentGold: '#D4A853',
  border: '#3D362C',
  success: '#7A9B5A',
} as const;

export const fonts = {
  heading: "'Space Mono', monospace",
  body: "'Inter', sans-serif",
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
} as const;

export const spacing = {
  xs: 4, sm: 8, md: 12, base: 16, lg: 24, xl: 32, xxl: 48, xxxl: 64,
} as const;

export const radius = {
  sm: 4, md: 8, lg: 12, pill: 9999,
} as const;

export const sectionColors = {
  warmsignal:  { bg: '#3A2E1A', accent: '#D4A853', label: 'warm signal' },
  softdrift:   { bg: '#1E2E1A', accent: '#7A9B5A', label: 'soft drift' },
  nightdrive:  { bg: '#3A2218', accent: '#E8622B', label: 'night drive' },
  otherside:   { bg: '#1A2A30', accent: '#5A9B9B', label: 'other side' },
  static:      { bg: '#30192A', accent: '#C45A8A', label: 'static' },
} as const;

export type SectionId = keyof typeof sectionColors;

export const sectionMeta: Record<SectionId, { label: string; tagline: string }> = {
  warmsignal:  { label: 'warm signal',  tagline: 'Artists closest to your frequency' },
  softdrift:   { label: 'soft drift',   tagline: 'A gentle stretch from your usual' },
  nightdrive:  { label: 'night drive',  tagline: 'Deeper cuts, darker moods' },
  otherside:   { label: 'other side',   tagline: 'Different energy entirely' },
  static:      { label: 'static',       tagline: 'The furthest out we could find' },
};
