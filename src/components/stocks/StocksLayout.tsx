import { NavLink, Outlet } from 'react-router-dom';

/** Nur Outlet — Navigation ausschließlich über die Topbar. */
export function StocksLayout() {
  return <Outlet />;
}
