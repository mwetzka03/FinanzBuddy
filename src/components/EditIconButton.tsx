import type { ButtonHTMLAttributes } from 'react';
import { useUi } from '../lib/ui';

type EditIconButtonProps = {
  label: string;
} & Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'disabled'>;

export function EditIconButton(props: EditIconButtonProps) {
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
        e.currentTarget.style.color = colors.accentDark;
        e.currentTarget.style.borderColor = colors.accent;
        e.currentTarget.style.background = colors.accentSoft;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = colors.textMuted;
        e.currentTarget.style.borderColor = colors.border;
        e.currentTarget.style.background = colors.bgMuted;
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3zM14.5 6.5l3 3"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
