import type { ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { useUi } from '../lib/ui';

type DetailLinkProps = Omit<LinkProps, 'style' | 'className'> & {
  children: ReactNode;
};

export function DetailLink({ children, ...props }: DetailLinkProps) {
  const ui = useUi();
  return (
    <Link {...props} style={ui.detailLink} className="fh-detail-link">
      {children}
    </Link>
  );
}
