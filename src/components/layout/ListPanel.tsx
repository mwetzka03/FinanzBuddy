import type { ReactNode } from 'react';
import { useUi } from '../../lib/ui';
import { SectionHint } from './SectionHint';

export function ListPanel({ title = 'Einträge', hint, children }: { title?: string; hint?: string; children: ReactNode }) {
  const ui = useUi();
  return (
    <section style={ui.listPanel} className="fh-panel fh-panel--list">
      <h2 style={ui.sectionTitle}>{title}</h2>
      {hint && <SectionHint>{hint}</SectionHint>}
      {children}
    </section>
  );
}
