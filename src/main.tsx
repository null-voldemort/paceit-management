import { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LoginScreen } from './components/LoginScreen';
import { AppUser } from './types';
import { getCurrentUser, onAuthChange, signOut } from './utils/auth';
import { hideSplash } from './utils/splash';
import './index.css';

const App = lazy(() => import('./App.tsx'));

function Root() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    getCurrentUser()
      .then((current) => {
        if (mounted) {
          setUser(current);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });

    const unsubscribe = onAuthChange((current) => {
      if (mounted) setUser(current);
    });

    return () => {
      mounted = false;
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    if (!loading && !user) hideSplash();
  }, [loading, user]);

  if (loading) return null;

  if (!user) {
    return <LoginScreen onUnlock={setUser} />;
  }

  return (
    <Suspense fallback={null}>
      <App
        currentUser={user}
        onLock={async () => {
          await signOut();
          setUser(null);
        }}
      />
    </Suspense>
  );
}

createRoot(document.getElementById('root')!).render(<Root />);
