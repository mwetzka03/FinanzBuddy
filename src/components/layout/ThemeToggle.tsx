import { Moon, Sun } from 'lucide-react';
import { useUi } from '../../lib/ui';

export function ThemeToggle() {
  const { mode, toggle } = useUi();
  const isDark = mode === 'dark';

  return (
    <button
      type="button"
      className="fh-theme-btn"
      onClick={toggle}
      aria-label={isDark ? 'Light Mode' : 'Dark Mode'}
      title={isDark ? 'Light Mode' : 'Dark Mode'}
    >
      {isDark ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
    </button>
  );
}
