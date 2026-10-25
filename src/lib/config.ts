/**
 * Central product configuration.
 *
 * Product name, phase label, and authorship metadata live here so they can be
 * changed in one place. Individual authorship and institutional context are
 * deliberately separate fields and must not be merged.
 */
export const APP_CONFIG = {
  /**
   * Artistic project. Use this when the work itself is the subject.
   * The software is `productName`.
   */
  projectName: 'doodog',

  /** Creative coding application. */
  productName: 'doodog studio',

  /** doodog — Drawing with four legs. */
  tagline: 'Drawing with four legs.',

  /** doodog studio — A creative coding environment for robotic drawing. */
  description: 'A creative coding environment for robotic drawing.',

  repositoryUrl: 'https://github.com/linalopes/doodog',

  /** Current development phase, shown in the shell. */
  phase: {
    id: '05B',
    label: 'Phase 05B · Three-leg stance',
  },

  /**
   * Person who conceived, designed, and developed the application.
   * Distinct from the institutional / educational context below.
   */
  author: {
    name: 'Lina Lopes',
    role: 'Concept, interaction design and development',
    url: 'https://linalopes.info/',
  },

  /** Institutional context — not interchangeable with the author credit. */
  organization: {
    name: "School of Tomorrow's AI",
    role: 'Institutional context',
    url: 'https://schoolai.linalopes.info/',
  },

  brandKitUrl: 'https://linalopes.github.io/SchoolAI-brand-kit/',

  /** Namespace for every LocalStorage key written by the application. */
  storagePrefix: 'doodog',

  /** Target robot for the Simulate and Robot workspaces. */
  robot: {
    name: 'Unitree Go2',
    legs: ['FL', 'FR', 'RL', 'RR'] as const,
  },
} as const;
