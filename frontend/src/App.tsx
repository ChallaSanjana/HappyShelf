import { useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { Login } from './components/Login';
import { Register } from './components/Register';
import { ForgotPassword } from './components/ForgotPassword';
import { ResetPassword } from './components/ResetPassword';
import { Dashboard } from './components/Dashboard';
import { useResetPasswordToken } from './hooks/useResetPasswordToken';

type AuthScreen = 'login' | 'register' | 'forgot';

const AppContent = () => {
  const [authScreen, setAuthScreen] = useState<AuthScreen>('login');
  const { user, isLoading, sessionMessage, clearSessionMessage } = useAuth();
  const { isResetRoute, token: resetToken, clear: clearResetRoute } = useResetPasswordToken();

  // Takes priority over everything else, including an active session — the
  // token authorises the change on its own, and whoever is signed in on this
  // browser right now may not be who the email was for.
  if (isResetRoute) {
    return (
      <ResetPassword
        token={resetToken}
        onDone={() => {
          clearResetRoute();
          setAuthScreen('login');
        }}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <p className="text-gray-600" role="status">
          Loading...
        </p>
      </div>
    );
  }

  if (!user) {
    // sessionMessage is set when the session ended on its own — expired,
    // revoked by a role change, or the account deactivated. Without it the
    // user would be dropped at the login screen with no idea why.
    if (authScreen === 'register') {
      return (
        <Register
          onToggle={() => {
            clearSessionMessage();
            setAuthScreen('login');
          }}
        />
      );
    }

    if (authScreen === 'forgot') {
      return <ForgotPassword onBackToLogin={() => setAuthScreen('login')} />;
    }

    return (
      <Login
        onToggle={() => {
          clearSessionMessage();
          setAuthScreen('register');
        }}
        onForgotPassword={() => setAuthScreen('forgot')}
        notice={sessionMessage}
      />
    );
  }

  return <Dashboard />;
};

function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ToastProvider>
  );
}

export default App;
