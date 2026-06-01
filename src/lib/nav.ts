import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeftRight,
  Landmark,
  LayoutDashboard,
  LineChart,
  ListChecks,
  MoreHorizontal,
  Newspaper,
  PiggyBank,
  Repeat,
  ShoppingCart,
  Tags,
  TrendingUp,
  Wallet,
} from 'lucide-react';

export type NavItem = { to: string; labelKey: string; end?: boolean; icon?: LucideIcon };

export type NavSection = {
  id: string;
  labelKey: string;
  icon: LucideIcon;
  items?: NavItem[];
  to?: string;
  end?: boolean;
};

export const NAV_SECTIONS: NavSection[] = [
  { id: 'dashboard', labelKey: 'nav.dashboard', to: '/', end: true, icon: LayoutDashboard },
  { id: 'transaktionen', labelKey: 'nav.transactions', to: '/transaktionen', icon: ArrowLeftRight },
  {
    id: 'ausgaben',
    labelKey: 'nav.expenses',
    icon: Wallet,
    items: [
      { to: '/fixkosten', labelKey: 'nav.fixedCosts', icon: Repeat },
      { to: '/variable-kosten', labelKey: 'nav.variableCosts', icon: ListChecks },
      { to: '/buy-liste', labelKey: 'nav.buyList', icon: ShoppingCart },
    ],
  },
  {
    id: 'aktien',
    labelKey: 'nav.stocks',
    icon: TrendingUp,
    items: [
      { to: '/aktien', labelKey: 'nav.depot', end: true, icon: LineChart },
      { to: '/aktien/news', labelKey: 'nav.news', icon: Newspaper },
    ],
  },
  {
    id: 'weiteres',
    labelKey: 'nav.more',
    icon: MoreHorizontal,
    items: [
      { to: '/accounts', labelKey: 'nav.accounts', icon: Landmark },
      { to: '/schulden', labelKey: 'nav.debts', icon: PiggyBank },
      { to: '/ausgabengruppen', labelKey: 'nav.expenseGroups', icon: Tags },
    ],
  },
];

export function isNavSectionActive(section: NavSection, pathname: string): boolean {
  if (section.to) return section.end ? pathname === section.to : pathname.startsWith(section.to);
  return section.items?.some((i) => pathname === i.to || pathname.startsWith(`${i.to}/`)) ?? false;
}

export function findActiveNavParent(pathname: string): NavSection | undefined {
  return NAV_SECTIONS.find((s) => s.items && isNavSectionActive(s, pathname));
}
