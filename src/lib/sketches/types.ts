/** User-editable p5 sketch persisted in LocalStorage. */

export type SketchOrigin = 'blank' | 'example';

export interface Sketch {
  id: string;
  name: string;
  source: string;
  /** Built-in example id when this sketch was created from an example. */
  exampleId: string | null;
  origin: SketchOrigin;
  createdAt: number;
  updatedAt: number;
}

/** Immutable built-in template. Opening the gallery never mutates these. */
export interface SketchExample {
  id: string;
  name: string;
  description: string;
  source: string;
  /** Short tags shown on gallery cards. */
  tags: readonly string[];
}

/** Persisted sketch collection schema version. */
export const SKETCH_STORAGE_VERSION = 1;
