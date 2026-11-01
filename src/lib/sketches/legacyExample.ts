import { getExampleById } from './examples.ts';

/**
 * A saved example still drives the unused leg when its `restingBrush()` sets
 * `contact: false` and omits `active`. The example id has to match a current
 * single-brush template that does set `active: false`, and `motion()` has to
 * call that function. An edited sketch that no longer has this function is
 * left alone. A missing example id is not guessed.
 */
const RESTING_CALL = 'const resting = restingBrush()';

export function isUnchangedOlderExample(
  sketch: { exampleId: string | null; source: string } | null | undefined,
): boolean {
  if (!sketch?.exampleId) return false;
  const example = getExampleById(sketch.exampleId);
  if (!example || !restingBody(example.source)?.includes('active: false')) return false;
  if (sketch.source === example.source) return false;
  if (!sketch.source.includes(RESTING_CALL)) return false;
  const body = restingBody(sketch.source);
  if (!body) return false;
  return body.includes('contact: false') && !body.includes('active');
}

function restingBody(source: string): string | null {
  const match = source.match(/function restingBrush\(\)\s*\{[\s\S]*?\n\}/);
  return match ? match[0] : null;
}
