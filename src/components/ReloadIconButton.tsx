import type { ButtonHTMLAttributes } from 'react';
import { useUi } from '../lib/ui';

type ReloadIconButtonProps = {
  label: string;
} & Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'disabled'>;

export function ReloadIconButton(props: ReloadIconButtonProps) {
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
        background: colors.bgCard,
        color: colors.text,
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => {
        if (props.disabled) return;
        e.currentTarget.style.borderColor = colors.accent;
        e.currentTarget.style.color = colors.accentDark;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = colors.border;
        e.currentTarget.style.color = colors.text;
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4 4v6h6M20 20v-6h-6"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M20 9a8 8 0 0 0-14.9-3M4 15a8 8 0 0 0 14.9 3"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
