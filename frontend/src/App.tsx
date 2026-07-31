import { useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { Login } from './components/Login';
import { Register } from './components/Register';
import { Dashboard } from './components/Dashboard';

const AppContent = () => {
  const [showLogin, setShowLogin] = useState(true);
  const { user, isLoading, sessionMessage, clearSessionMessage } = useAuth();

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
    return showLogin ? (
      <Login
        onToggle={() => {
          clearSessionMessage();
          setShowLogin(false);
        }}
        notice={sessionMessage}
      />
    ) : (
      <Register
        onToggle={() => {
          clearSessionMessage();
          setShowLogin(true);
        }}
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
