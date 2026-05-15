import { useState } from "react";
import { LoginScreen } from "./components/LoginScreen";
import AdminMainScreen from "./components/AdminMainScreen";
import {
  clearAdminSession,
  readAdminSessionUserId,
  writeAdminSession,
} from "./auth/sessionStorage";

export default function App() {
  const [sessionUserId, setSessionUserId] = useState(() =>
    readAdminSessionUserId()
  );

  function handleLoginSuccess(loggedInUserId: string) {
    writeAdminSession(loggedInUserId);
    setSessionUserId(readAdminSessionUserId());
  }

  function handleLogout() {
    clearAdminSession();
    setSessionUserId(null);
  }

  return sessionUserId ? (
    <AdminMainScreen
      onLogout={handleLogout}
      loggedInUserId={sessionUserId}
    />
  ) : (
    <LoginScreen onLoginSuccess={handleLoginSuccess} />
  );
}
