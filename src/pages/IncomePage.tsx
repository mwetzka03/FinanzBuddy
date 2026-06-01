import { Navigate, useSearchParams } from 'react-router-dom';

/** Legacy route — leitet zur integrierten Transaktions-Ansicht weiter. */
export function IncomePage() {
  const [params] = useSearchParams();
  const view = params.get('view') === 'transactions' ? 'transactions' : 'forecasts';
  return <Navigate to={`/transaktionen?view=${view}`} replace />;
}
