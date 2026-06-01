import type { ButtonHTMLAttributes } from 'react';
import { useUi } from '../lib/ui';

type CancelIconButtonProps = {
  label: string;
} & Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'disabled'>;

export function CancelIconButton(props: CancelIconButtonProps) {
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
        e.currentTarget.style.color = colors.text;
        e.currentTarget.style.borderColor = colors.textMuted;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = colors.textMuted;
        e.currentTarget.style.borderColor = colors.border;
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    </button>
  );
}
