/** THIS FILE DOES: Human-readable category metadata and source registry shared by nav/filter/timeline/globe UI, ROLE: UI, MAINTAINER NOTE: Order and ids must mirror CATEGORIES in core/SpatialStore.js; add new domains (climate, space) as additional SOURCES entries. **/
import { CATEGORIES } from '../core/SpatialStore.js';

const LABELS = {
  genomics: 'Genomics',
  oncology: 'Oncology',
  neuroscience: 'Neuroscience',
  'infectious-disease': 'Infectious disease',
  immunology: 'Immunology',
  cardiometabolic: 'Cardiometabolic',
  'regenerative-medicine': 'Regenerative medicine',
  'public-health': 'Public health',
  'ai-in-medicine': 'AI in medicine',
  'rare-disease': 'Rare disease',
};

// Ten hues spread around the wheel so no two categories read alike (the old palette had two
// near-identical reds, and blue/sky-blue plus orange/gold pairs). Mid-lightness so every dot works
// on both the white and the black theme, and on the globe texture behind its white ring.
const COLORS = {
  genomics: '#0A84FF',
  oncology: '#FF453A',
  neuroscience: '#BF5AF2',
  'infectious-disease': '#FF9F0A',
  immunology: '#30B158',
  cardiometabolic: '#E8388C', // magenta, clearly apart from oncology red
  'regenerative-medicine': '#00B8A9', // teal, apart from genomics blue
  'public-health': '#C9B300', // olive-gold, apart from infectious orange
  'ai-in-medicine': '#5E5CE6',
  'rare-disease': '#A2845E',
};

export const CATEGORY_META = Object.freeze(
  Object.fromEntries(CATEGORIES.map((id) => [id, Object.freeze({ label: LABELS[id] ?? id, color: COLORS[id] ?? '#8E8E93' })]))
);

export const SOURCES = Object.freeze([
  Object.freeze({
    id: 'pubmed',
    label: 'Medical research',
    sublabel: 'PubMed · U.S. National Library of Medicine (nih.gov)',
    categories: [...CATEGORIES],
  }),
]);
