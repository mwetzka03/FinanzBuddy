import { Plus } from 'lucide-react';

export function AddEntryButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="fh-btn primary" onClick={onClick} disabled={disabled}>
      <Plus size={16} aria-hidden />
      {label}
    </button>
  );
}
