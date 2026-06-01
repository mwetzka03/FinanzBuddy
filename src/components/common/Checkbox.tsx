import { type ReactNode } from 'react';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  title?: string;
  className?: string;
  id?: string;
}

export function Checkbox({
  checked,
  onChange,
  children,
  hint,
  disabled,
  title,
  className,
  id,
}: CheckboxProps) {
  const labelClass = ['fh-checkbox', className].filter(Boolean).join(' ');

  return (
    <label className={labelClass} title={title}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {children != null || hint ? (
        <span className="fh-checkbox-content">
          {children != null ? <span className="fh-checkbox-label">{children}</span> : null}
          {hint ? <span className="fh-checkbox-hint">{hint}</span> : null}
        </span>
      ) : null}
    </label>
  );
}
