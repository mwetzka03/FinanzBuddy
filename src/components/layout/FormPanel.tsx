import type { ReactNode } from 'react';
import { useUi } from '../../lib/ui';
import { SectionHint } from './SectionHint';

export function FormPanel({ title, hint, children }: { title?: string; hint?: string; children: ReactNode }) {
  const ui = useUi();
  return (
    <section style={ui.formPanel} className="fh-panel fh-panel--form">
      {title && <h2 style={ui.sectionTitle}>{title}</h2>}
      {hint && <SectionHint>{hint}</SectionHint>}
      {children}
    </section>
  );
}
