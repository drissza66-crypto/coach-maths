import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { Role } from '@mathsuivi/shared';
import { homePath, useAuth } from '../auth/AuthContext';

export function Layout() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();

  const links =
    me?.role === 'apprenti'
      ? [
          { to: '/apprenti', label: 'Accueil' },
          { to: '/mes-donnees', label: 'Mes données' },
        ]
      : me
        ? [
            { to: '/formateur', label: 'Mes classes' },
            { to: '/mes-donnees', label: 'Mon compte' },
          ]
        : [];

  return (
    <>
      <a className="skip-link" href="#contenu">
        Aller au contenu
      </a>
      <header className="header">
        <div className="header-inner">
          <Link to={homePath(me)} className="brand">
            <span className="brand-mark" aria-hidden="true">
              ÷
            </span>
            Coach Maths
          </Link>
          {me && (
            <nav className="nav" aria-label="Menu principal">
              {links.map((l) => (
                <NavLink key={l.to} to={l.to}>
                  {l.label}
                </NavLink>
              ))}
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={async () => {
                  await logout();
                  navigate('/');
                }}
              >
                Se déconnecter
              </button>
            </nav>
          )}
        </div>
      </header>
      <main id="contenu" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="footer">
        Coach Maths — appui en mathématiques pour les CAP du BTP. Sans publicité, sans pistage.
      </footer>
    </>
  );
}

export function RequireRole({ roles }: { roles: Role[] }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p role="status">Chargement…</p>;
  if (!me) return <Navigate to="/" replace />;
  if (!roles.includes(me.role)) return <Navigate to={homePath(me)} replace />;
  if (me.role === 'apprenti' && me.doitChangerPin && location.pathname !== '/apprenti/code') {
    return <Navigate to="/apprenti/code" replace />;
  }
  return <Outlet />;
}
