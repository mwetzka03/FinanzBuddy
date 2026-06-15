import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { openExternalUrl } from '../../tauri/api';

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)}\]'"])/gi;

async function openLink(url: string, event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  event.stopPropagation();
  try {
    await openExternalUrl(url);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

function linkNodes(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(URL_RE);
  if (parts.length <= 1) return [text];
  const nodes: ReactNode[] = [];
  let matchIndex = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (i % 2 === 1) {
      nodes.push(
        <a
          key={`${keyPrefix}-link-${matchIndex++}`}
          href={part}
          onClick={(event) => void openLink(part, event)}
        >
          {part}
        </a>,
      );
    } else {
      nodes.push(part);
    }
  }
  return nodes;
}
export function LinkifiedText({ text, style }: { text: string; style?: CSSProperties }) {
  return <span style={style}>{linkNodes(text, 'link')}</span>;
}
