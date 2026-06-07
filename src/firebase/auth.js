import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { app } from "./config.js";

const auth = app ? getAuth(app) : null;

let authReady = null;

export async function ensureAuth() {
  if (!auth) {
    throw new Error(
      "Firebase is not configured. Check VITE_FIREBASE_* in .env and restart the dev server."
    );
  }

  if (auth.currentUser) {
    return auth.currentUser;
  }

  if (!authReady) {
    authReady = new Promise((resolve, reject) => {
      const unsubscribe = onAuthStateChanged(auth, async (user) => {
        if (user) {
          unsubscribe();
          resolve(user);
          return;
        }

        try {
          const result = await signInAnonymously(auth);
          unsubscribe();
          resolve(result.user);
        } catch (err) {
          unsubscribe();
          authReady = null;
          reject(err);
        }
      });
    });
  }

  return authReady;
}

export function getCurrentUser() {
  return auth?.currentUser ?? null;
}
