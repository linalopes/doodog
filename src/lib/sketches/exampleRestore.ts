/**
 * Create owns the live iframe. Simulate can ask it to replace an example
 * copy and run that source. The caller has already confirmed.
 */
type RestoreHandler = (id: string) => void;

let handler: RestoreHandler | null = null;

export function bindExampleRestore(next: RestoreHandler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

export function requestExampleRestore(id: string): void {
  handler?.(id);
}
