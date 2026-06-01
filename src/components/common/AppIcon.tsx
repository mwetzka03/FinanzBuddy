import { COLOR_OPTIONS, ICON_OPTIONS, getIcon } from '../../lib/icons';

interface AppIconProps {
  name: string;
  size?: number;
  color?: string;
}

export function AppIcon({ name, size = 18, color }: AppIconProps) {
  const Icon = getIcon(name);
  return <Icon size={size} color={color} strokeWidth={2.2} aria-hidden />;
}

interface IconPickerProps {
  value: string;
  onChange: (name: string) => void;
}

export function IconPicker({ value, onChange }: IconPickerProps) {
  return (
    <div className="fh-icon-picker">
      {ICON_OPTIONS.map(({ name }) => (
        <button
          key={name}
          type="button"
          className={`fh-icon-picker-btn${value === name ? ' active' : ''}`}
          onClick={() => onChange(name)}
          aria-label={name}
        >
          <AppIcon name={name} size={16} />
        </button>
      ))}
    </div>
  );
}

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  return (
    <div className="fh-color-picker">
      {COLOR_OPTIONS.map((c) => (
        <button
          key={c}
          type="button"
          className={`fh-color-swatch${value === c ? ' active' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
          aria-label={c}
        />
      ))}
    </div>
  );
}

export function EntityIconBadge({
  icon,
  color,
  size = 22,
}: {
  icon: string;
  color: string;
  size?: number;
}) {
  return (
    <div className="fh-entity-icon" style={{ background: `${color}22`, color }}>
      <AppIcon name={icon} size={size} color={color} />
    </div>
  );
}
