/** Shared prop types for the layout components. */

export interface SidebarSection {
  id: string;
  label: string;
  /** Short qualifier shown under the label, e.g. availability. */
  hint?: string;
}
