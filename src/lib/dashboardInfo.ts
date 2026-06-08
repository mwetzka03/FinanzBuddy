export const DASHBOARD_INFO = {
  kontostand:
    'Ist-Saldo zum Stichtag (heute oder Monatsende): nur gebuchte Bewegungen, Korrekturen und Ist-Einnahmen — ohne Prognose-Einnahmen. Nur für Vergangenheit und Gegenwart sichtbar.',
  kontostandDelta:
    'Veränderung des Kontostands gegenüber Vormonat bzw. Vortag (Depot: Marktwert heute vs. investierte Kostenbasis zuvor).',
  startBalance:
    'Prognostizierter Saldo zu Monatsbeginn (Ist + offene Forecasts, ohne Einkaufszettel — die zählen in Ausgaben). Korrekturen fließen über den Ledger ein. Erster Monat: Backend-Prognose, danach: Endsaldo Vormonat.',
  startLiquid:
    'Liquide Mittel zu Monatsbeginn (Prognose). Erster Monat: Backend-Prognose (Korrekturen + Forecasts auf liquiden Konten), danach: Ende liquide Vormonat.',
  income:
    'Einnahmen im gewählten Zeitraum (gebucht + offene Prognosen). Einnahmen am letzten Bankarbeitstag zählen erst im Folgemonat. Klick filtert die Ereignisliste.',
  expenses:
    'Ausgaben im gewählten Zeitraum (gebucht + Prognosen) — ohne Transfers, Korrekturen und reine Depot-Käufe. Klick filtert die Ereignisliste.',
  net: 'Einnahmen minus Ausgaben im gewählten Monat.',
  fixedCosts: 'Wiederkehrende Fixkosten im Monat. Klick filtert die Ereignisliste.',
  variableCosts: 'Variable Monatskosten (Prognose oder Ist). Klick filtert die Ereignisliste.',
  buys: 'Angewendete Kaufposten und geplante Käufe im Monat.',
  debtOwed:
    'Offene Forderungen — Beträge, die dir andere schulden. Nur in der Gesamtübersicht (Alle Konten), fließen nicht in Kontosalden ein.',
  debtIOwe:
    'Offene Verbindlichkeiten — Beträge, die du anderen schuldest. Nur in der Gesamtübersicht (Alle Konten), fließen nicht in Kontosalden ein.',
  endBalance:
    'Prognostizierter Endsaldo = Startsaldo + Einnahmen − Ausgaben des Monats. Gleichzeitig Startsaldo des Folgemonats.',
  deltaBalance: 'Veränderung vom Startsaldo zum Endsaldo (= Einnahmen − Ausgaben).',
  endLiquid: 'Liquide Mittel am Monatsende (Prognose) = Start liquide + Einnahmen − Ausgaben + Transfers auf liquiden Konten.',
  deltaLiquid:
    'Veränderung der liquiden Mittel im Monat (Einnahmen − Ausgaben ± Transfers zwischen liquiden und nicht-liquiden Konten).',
  dayTotal: 'Prognostizierter Gesamtsaldo an diesem Tag inkl. aller liquiden Konten.',
  dayIncome: 'Positive Buchungen an diesem Tag (ohne Transfers und Korrekturen).',
  dayExpenses: 'Ausgaben an diesem Tag (ohne Transfers und Korrekturen).',
} as const;
