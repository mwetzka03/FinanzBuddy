import type { ReactNode } from 'react';
import { useUi } from '../../lib/ui';

export function SectionHint({ children }: { children: ReactNode }) {
  const ui = useUi();
  return <p style={ui.sectionHint}>{children}</p>;
}
