import type { ButtonHTMLAttributes } from 'react';
import { useUi } from '../lib/ui';

type TrashIconButtonProps = {
  label: string;
} & Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'disabled'>;

export function TrashIconButton(props: TrashIconButtonProps) {
  const { colors } = useUi();

  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        padding: 0,
        flexShrink: 0,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        background: colors.bgMuted,
        color: colors.textMuted,
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => {
        if (props.disabled) return;
        e.currentTarget.style.color = colors.dangerBorder;
        e.currentTarget.style.borderColor = colors.dangerBorder;
        e.currentTarget.style.background = colors.dangerBg;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = colors.textMuted;
        e.currentTarget.style.borderColor = colors.border;
        e.currentTarget.style.background = colors.bgMuted;
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4 7h16M9 7V5h6v2M10 11v6M14 11v6M6 7l1 12h10l1-12"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
