import { createContext, useContext } from "react";
import type { RouterAuthContext } from "./router";

const AuthContext = createContext<RouterAuthContext | null>(null);

export function AuthProvider({
  auth,
  children,
}: {
  auth: RouterAuthContext;
  children: React.ReactNode;
}) {
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const auth = useContext(AuthContext);

  if (!auth) {
    throw new Error("Auth context is unavailable.");
  }

  return auth;
}
