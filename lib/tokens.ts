// === 90s Hip-Hop Zine Design Tokens ===

export const colors = {
  bg: '#FFFDF5',
  surface: '#FFF8EA',
  text: '#111111',
  textMuted: '#6B6B6B',
  accent: '#FF4D00',
  border: '#E5DDD0',
  success: '#2D8B4E',
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
  roots:     { bg: '#F5EDE4', accent: '#8B6914', label: 'ROOTS' },
  edges:     { bg: '#E8F0E4', accent: '#3D6B2E', label: 'EDGES' },
  crowd:     { bg: '#FCE8D8', accent: '#B5541A', label: 'CROWD' },
  blindspot: { bg: '#E4ECF5', accent: '#2E4A6B', label: 'BLINDSPOT' },
  deepwork:  { bg: '#EDEBE8', accent: '#555555', label: 'DEEP WORK' },
  wildcard:  { bg: '#F5E4EE', accent: '#8B1454', label: 'WILDCARD' },
} as const;

export type SectionId = keyof typeof sectionColors;

export const sectionMeta: Record<SectionId, { label: string; tagline: string }> = {
  roots:     { label: 'ROOTS',     tagline: 'Where your sound was born' },
  edges:     { label: 'EDGES',     tagline: 'Where your taste is heading' },
  crowd:     { label: 'CROWD',     tagline: 'What your people are playing' },
  blindspot: { label: 'BLINDSPOT', tagline: "Important music you've never touched" },
  deepwork:  { label: 'DEEP WORK', tagline: 'Disappear for 3 hours' },
  wildcard:  { label: 'WILDCARD',  tagline: 'Completely outside your bubble' },
};
