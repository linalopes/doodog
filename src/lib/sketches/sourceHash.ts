/**
 * Fast, stable, non-cryptographic hash of sketch source (djb2 variant).
 * Used to detect "source changed since last run", never for security.
 */
export function hashSource(source: string): string {
  let hash = 5381;
  for (let i = 0; i < source.length; i += 1) {
    hash = ((hash << 5) + hash + source.charCodeAt(i)) | 0;
  }
  return `${source.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}
