import type { InputHTMLAttributes } from 'react';
import { useUi } from '../lib/ui';

type OptionalDescriptionInputProps = {
  value: string;
  onChange: (value: string) => void;
} & Pick<InputHTMLAttributes<HTMLInputElement>, 'disabled'>;

export function OptionalDescriptionInput(props: OptionalDescriptionInputProps) {
  const { input, colors } = useUi();

  return (
    <input
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder="Beschreibung (optional)"
      style={{ ...input, marginTop: 6, fontSize: 13, color: colors.textMuted }}
    />
  );
}
