import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { useSession } from './store/session';
import { Login } from './routes/login';
import { Widgets } from './routes/widgets';

/**
 * Auth guarding in one component. A route that guards itself is a route someone
 * can forget to guard.
 */
function Protected({ children }: { children: ReactNode }) {
  const status = useSession((s) => s.status);
  if (status === 'loading') return <p className="p-8 text-center text-neutral-500">Loading…</p>;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  const restore = useSession((s) => s.restore);
  const navigate = useNavigate();

  useEffect(() => {
    void restore();
  }, [restore]);

  // Android's hardware back button is not browser history. Without this the
  // button backs out of the app from any screen, which reads as a crash.
  useEffect(() => {
    const listener = CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) navigate(-1);
      else void CapacitorApp.exitApp();
    });
    return () => {
      void listener.then((l) => l.remove());
    };
  }, [navigate]);

  return (
    <div
      className="min-h-full bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-50"
      style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}
    >
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/widgets"
          element={
            <Protected>
              <Widgets />
            </Protected>
          }
        />
        {/* si:routes */}
        <Route path="*" element={<Navigate to="/widgets" replace />} />
      </Routes>
    </div>
  );
}
