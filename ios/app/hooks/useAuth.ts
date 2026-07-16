import { useCallback, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInAnonymously,
  type User,
} from "firebase/auth";
import { auth, isFirebaseConfigured } from "../firebase/config";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setLoading(false);
      setError("Firebase is not configured");
      return;
    }

    const unsub = onAuthStateChanged(auth, (next) => {
      setUser(next);
      setLoading(false);
    });
    return unsub;
  }, []);

  const ensureAnonymous = useCallback(async () => {
    if (!auth) throw new Error("Firebase auth unavailable");
    if (auth.currentUser) return auth.currentUser;
    const cred = await signInAnonymously(auth);
    return cred.user;
  }, []);

  return { user, loading, error, ensureAnonymous, isReady: Boolean(user) };
}
