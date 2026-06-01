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
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: `0 0 ${CARD_MIN_WIDTH}px`,
                minWidth: CARD_MIN_WIDTH,
                maxWidth: 360,
                minHeight: 220,
                padding: '16px 18px',
                borderRadius: 14,
                border: `1px solid ${ui.colors.border}`,
                background: `linear-gradient(160deg, ${ui.colors.bgCard} 0%, ${ui.colors.accentSoft}33 100%)`,
                textAlign: 'left',
                cursor: 'pointer',
                color: ui.colors.text,
                scrollSnapAlign: 'start',
              }}
              className="fh-news-card"
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: article.category === 'depot' ? ui.colors.accentDark : ui.colors.textMuted,
                  }}
                >
                  {article.symbol ?? article.source}
                </span>
                <span style={{ fontSize: 11, color: ui.colors.textMuted }}>{formatDisplayDateTime(article.publishedAt)}</span>
              </div>
              <h4 style={{ margin: '12px 0 8px', fontSize: 16, lineHeight: 1.35, color: ui.colors.accentDark, flex: 1 }}>
                {article.title}
              </h4>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: ui.colors.textMuted,
                  display: '-webkit-box',
                  WebkitLineClamp: 4,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {article.summary}
              </p>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
