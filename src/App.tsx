import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useNavLayout } from './lib/layoutPreference';
import { devLog } from './lib/startupDevLog';
import { isDeveloperModeEnabled } from './lib/developerMode';
import { useCalcLogBridge } from './lib/calcLogBridge';
import { AppShell } from './components/layout/AppShell';
import { LoadingOverlay } from './components/layout/LoadingOverlay';
import { DeveloperLogDock } from './components/common/DeveloperLogDock';
import { OnboardingOverlay } from './components/onboarding/OnboardingOverlay';
import { getSetupState } from './tauri/api';

import { BuyListPage } from './pages/BuyListPage';

import { DashboardPage } from './pages/DashboardPage';

import { DebtDetailPage } from './pages/DebtDetailPage';

import { DebtsPage } from './pages/DebtsPage';

import { ExpenseGroupDetailPage } from './pages/ExpenseGroupDetailPage';

import { ExpenseGroupsPage } from './pages/ExpenseGroupsPage';

import { FixedCostsPage } from './pages/FixedCostsPage';

import { IncomeForecastDetailPage } from './pages/IncomeForecastDetailPage';

import { IncomePage } from './pages/IncomePage';

import { StockDetailPage } from './pages/StockDetailPage';

import { StockNewsPage } from './pages/StockNewsPage';

import { StocksPage } from './pages/StocksPage';

import { StocksLayout } from './components/stocks/StocksLayout';

import { TransactionsPage } from './pages/TransactionsPage';

import { VariableCostDetailPage } from './pages/VariableCostDetailPage';

import { VariableCostsPage } from './pages/VariableCostsPage';
import { BudgetPoolsPage } from './pages/BudgetPoolsPage';
import { SettingsPage } from './pages/SettingsPage';



export function App() {

  const location = useLocation();
  const { layout } = useNavLayout();
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);

  useCalcLogBridge();

  useEffect(() => {
    getSetupState()
      .then((s) => setSetupRequired(!s.completed))
      .catch(() => setSetupRequired(false));
  }, []);

  useEffect(() => {
    if (!setupRequired && isDeveloperModeEnabled()) {
      devLog('FinanzBuddy gestartet', 'ok', 'app');
    }
  }, [setupRequired]);

  useEffect(() => {
    if (setupRequired || !isDeveloperModeEnabled()) return;
    devLog(`Route aktiv: ${location.pathname}`, 'info', 'navigation');
  }, [location.pathname, setupRequired]);

  return (

    <div className={`fh-app fh-app--${layout}`}>

      {setupRequired === true ? (
        <>
          <div className="fh-setup-backdrop" aria-hidden="true">
            <div className="fh-setup-backdrop-skeleton" />
          </div>
          <OnboardingOverlay onComplete={() => setSetupRequired(false)} />
        </>
      ) : null}

      {setupRequired === false ? (
        <>
          <AppShell>
          <LoadingOverlay />

            <Routes>

              <Route path="/" element={<DashboardPage />} />

              <Route path="/accounts" element={<Navigate to="/settings" replace />} />

              <Route path="/transaktionen" element={<TransactionsPage />} />

              <Route path="/transaktionen/prognose/:id" element={<IncomeForecastDetailPage />} />

              <Route path="/fixkosten" element={<FixedCostsPage />} />

              <Route path="/variable-kosten" element={<VariableCostsPage />} />

              <Route path="/variable-kosten/:id" element={<VariableCostDetailPage />} />

              <Route path="/budgetpools" element={<BudgetPoolsPage />} />

              <Route path="/buy-liste" element={<BuyListPage />} />
              <Route path="/einkaufszettel" element={<Navigate to="/buy-liste" replace />} />

              <Route path="/einnahmen/prognose/:id" element={<IncomeForecastDetailPage />} />

              <Route path="/einnahmen/prognose" element={<IncomePage />} />

              <Route path="/einnahmen" element={<IncomePage />} />

              <Route path="/prognosen" element={<IncomePage />} />

              <Route path="/aktien" element={<StocksLayout />}>
                <Route index element={<StocksPage />} />
                <Route path="news" element={<StockNewsPage />} />
                <Route path=":id" element={<StockDetailPage />} />
              </Route>

              <Route path="/ausgabengruppen" element={<ExpenseGroupsPage />} />

              <Route path="/ausgabengruppen/:id" element={<ExpenseGroupDetailPage />} />

              <Route path="/schulden" element={<DebtsPage />} />

              <Route path="/schulden/:id" element={<DebtDetailPage />} />

              <Route path="/settings" element={<SettingsPage />} />

            </Routes>
          </AppShell>
        </>
      ) : null}

      {setupRequired === null ? (
        <div className="fh-setup-wait" aria-busy="true" aria-live="polite" />
      ) : null}

      <DeveloperLogDock />

    </div>

  );

}
