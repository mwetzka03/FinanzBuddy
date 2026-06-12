import { useLayoutEffect, useRef, useState } from 'react';
import type { NewsArticle } from '../../lib/types';
import { formatDisplayDateTime } from '../../lib/date';
import { openExternalUrl } from '../../tauri/api';
import { useUi } from '../../lib/ui';

const CARD_MIN_WIDTH = 280;
const CARD_GAP = 12;

type NewsCarouselRowProps = {
  title: string;
  hint?: string;
  articles: NewsArticle[];
  emptyText: string;
};

export function NewsCarouselRow({ title, hint, articles, emptyText }: NewsCarouselRowProps) {
  const ui = useUi();
  const trackRef = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  function updateScrollState() {
    const el = trackRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setCanPrev(el.scrollLeft > 4);
    setCanNext(el.scrollLeft < maxScroll - 4);
  }

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    updateScrollState();
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(el);
    el.addEventListener('scroll', updateScrollState, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', updateScrollState);
    };
  }, [articles.length]);

  function scrollBy(direction: -1 | 1) {
    const el = trackRef.current;
    if (!el) return;
    const firstCard = el.querySelector<HTMLElement>('.fh-news-card');
    const step = (firstCard?.offsetWidth ?? CARD_MIN_WIDTH) + CARD_GAP;
    el.scrollBy({ left: direction * step, behavior: 'smooth' });
  }

  async function openArticle(url: string) {
    setOpenError(null);
    try {
      await openExternalUrl(url);
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: 0, color: ui.colors.accentDark }}>{title}</h3>
          {hint ? <p style={{ margin: '4px 0 0', fontSize: 13, color: ui.colors.textMuted }}>{hint}</p> : null}
          {openError ? <p style={{ margin: '4px 0 0', fontSize: 13, color: ui.colors.dangerBorder }}>{openError}</p> : null}
        </div>
        {articles.length > 1 ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              style={{ ...ui.btn, opacity: canPrev ? 1 : 0.4, cursor: canPrev ? 'pointer' : 'not-allowed' }}
              disabled={!canPrev}
              onClick={() => scrollBy(-1)}
              aria-label="Vorherige News"
            >
              ◀
            </button>
            <button
              type="button"
              style={{ ...ui.btn, opacity: canNext ? 1 : 0.4, cursor: canNext ? 'pointer' : 'not-allowed' }}
              disabled={!canNext}
              onClick={() => scrollBy(1)}
              aria-label="Nächste News"
            >
              ▶
            </button>
          </div>
        ) : null}
      </div>

      {articles.length === 0 ? (
        <div style={{ ...ui.emptyRow, borderRadius: 14, border: `1px dashed ${ui.colors.border}` }}>{emptyText}</div>
      ) : (
        <div
          ref={trackRef}
          style={{
            display: 'flex',
            gap: CARD_GAP,
            overflowX: 'auto',
            scrollSnapType: 'x mandatory',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            paddingBottom: 4,
          }}
          className="fh-news-track"
        >
          {articles.map((article) => (
            <button
              key={article.id}
              type="button"
              onClick={() => openArticle(article.url)}
              className="fh-news-card"
            >
              <div className="fh-news-card__meta">
                <span className={`fh-news-card__badge${article.category === 'depot' ? ' fh-news-card__badge--depot' : ''}`}>
                  {article.symbol ?? article.source}
                </span>
                <span className="fh-news-card__date">{formatDisplayDateTime(article.publishedAt)}</span>
              </div>
              <h4 className="fh-news-card__title">{article.title}</h4>
              <p className="fh-news-card__summary">{article.summary}</p>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
