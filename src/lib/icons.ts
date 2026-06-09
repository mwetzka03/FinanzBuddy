import {
  Activity,
  Apple,
  Banknote,
  Bell,
  Bike,
  BookOpen,
  Briefcase,
  Calendar,
  Camera,
  Car,
  CheckCircle2,
  Cloud,
  Code2,
  Coffee,
  Dumbbell,
  Gamepad2,
  Gift,
  GraduationCap,
  Heart,
  Home,
  Landmark,
  Leaf,
  Lightbulb,
  ListChecks,
  Moon,
  Music,
  Palette,
  PartyPopper,
  Phone,
  PiggyBank,
  Pill,
  Plane,
  Repeat,
  ShoppingBag,
  Store,
  Sun,
  Target,
  TrendingUp,
  Trophy,
  Utensils,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { BeerIcon, CigaretteIcon, TentIcon } from './customIcons';

export const ICON_OPTIONS: { name: string; icon: LucideIcon }[] = [
  // Health & fitness
  { name: 'dumbbell', icon: Dumbbell },
  { name: 'heart', icon: Heart },
  { name: 'apple', icon: Apple },
  { name: 'activity', icon: Activity },
  { name: 'pill', icon: Pill },
  // Food & drink
  { name: 'utensils', icon: Utensils },
  { name: 'coffee', icon: Coffee },
  { name: 'beer', icon: BeerIcon },
  { name: 'cigarette', icon: CigaretteIcon },
  // Home & shopping
  { name: 'home', icon: Home },
  { name: 'shop', icon: ShoppingBag },
  { name: 'store', icon: Store },
  // Transport
  { name: 'car', icon: Car },
  { name: 'plane', icon: Plane },
  { name: 'bike', icon: Bike },
  { name: 'tent', icon: TentIcon },
  // Nature & weather
  { name: 'leaf', icon: Leaf },
  { name: 'sun', icon: Sun },
  { name: 'moon', icon: Moon },
  { name: 'cloud', icon: Cloud },
  // Finance
  { name: 'banknote', icon: Banknote },
  { name: 'landmark', icon: Landmark },
  { name: 'piggybank', icon: PiggyBank },
  { name: 'trending', icon: TrendingUp },
  { name: 'calendar', icon: Calendar },
  // Work & education
  { name: 'briefcase', icon: Briefcase },
  { name: 'graduation', icon: GraduationCap },
  { name: 'code', icon: Code2 },
  { name: 'lightbulb', icon: Lightbulb },
  { name: 'phone', icon: Phone },
  // Leisure
  { name: 'gamepad', icon: Gamepad2 },
  { name: 'music', icon: Music },
  { name: 'camera', icon: Camera },
  { name: 'palette', icon: Palette },
  { name: 'book', icon: BookOpen },
  { name: 'gift', icon: Gift },
  { name: 'trophy', icon: Trophy },
  { name: 'party', icon: PartyPopper },
  { name: 'target', icon: Target },
  // Utilities
  { name: 'bell', icon: Bell },
  { name: 'zap', icon: Zap },
  { name: 'check', icon: CheckCircle2 },
  { name: 'repeat', icon: Repeat },
  { name: 'list', icon: ListChecks },
];

const iconMap = Object.fromEntries(ICON_OPTIONS.map((o) => [o.name, o.icon]));

/** Icons removed from the picker; map to a sensible replacement when loading stored data. */
export const DEPRECATED_ICON_ALIASES: Record<string, string> = {
  flame: 'zap',
  brain: 'lightbulb',
  cleaning: 'home',
  award: 'trophy',
  medal: 'trophy',
  crown: 'trophy',
  star: 'target',
  sparkles: 'party',
  smile: 'party',
  wallet: 'repeat',
  coins: 'banknote',
  users: 'target',
  flower: 'leaf',
  tree: 'leaf',
  rocket: 'target',
  scissors: 'target',
};

export function resolveIconName(name: string | null | undefined): string {
  if (!name) return 'target';
  if (iconMap[name]) return name;
  return DEPRECATED_ICON_ALIASES[name] ?? 'target';
}

export function getIcon(name: string): LucideIcon {
  return iconMap[resolveIconName(name)] ?? Target;
}

export const COLOR_OPTIONS = [
  '#ffffff',
  '#f5f5f5',
  '#e5e5e5',
  '#a3a3a3',
  '#525252',
  '#262626',
  '#171717',
  '#000000',
  '#6366f1',
  '#8b5cf6',
  '#7c3aed',
  '#9333ea',
  '#a855f7',
  '#ec4899',
  '#e11d48',
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#ca8a04',
  '#a3e635',
  '#84cc16',
  '#65a30d',
  '#4ade80',
  '#22c55e',
  '#16a34a',
  '#15803d',
  '#10b981',
  '#059669',
  '#047857',
  '#14b8a6',
  '#0d9488',
  '#06b6d4',
  '#0891b2',
  '#3b82f6',
  '#2563eb',
  '#64748b',
];

export const DEFAULT_KIND_ICON: Record<string, string> = {
  income: 'banknote',
  expense: 'shop',
  transfer: 'repeat',
  fixed_cost: 'calendar',
  buy_apply: 'shop',
  buy_planned: 'shop',
  adjustment: 'target',
  forecast: 'trending',
};

export const DEFAULT_KIND_COLOR: Record<string, string> = {
  income: '#10b981',
  expense: '#ec4899',
  transfer: '#6366f1',
  fixed_cost: '#8b5cf6',
  buy_apply: '#ec4899',
  buy_planned: '#ec4899',
  adjustment: '#64748b',
  forecast: '#3b82f6',
};
