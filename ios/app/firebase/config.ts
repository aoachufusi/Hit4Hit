import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, initializeAuth, type Auth } from "firebase/auth";
import { getDatabase, type Database } from "firebase/database";
import AsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
  databaseURL: process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    firebaseConfig.appId &&
    firebaseConfig.databaseURL
);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Database | null = null;

if (isFirebaseConfigured) {
  app = getApps().length ? getApps()[0]! : initializeApp(firebaseConfig);
  try {
    // Runtime export; not always present in firebase/auth TypeScript typings
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rnAuth = require("firebase/auth") as {
      getReactNativePersistence?: (storage: typeof AsyncStorage) => unknown;
    };
    if (rnAuth.getReactNativePersistence) {
      auth = initializeAuth(app, {
        persistence: rnAuth.getReactNativePersistence(
          AsyncStorage
        ) as never,
      });
    } else {
      auth = getAuth(app);
    }
  } catch {
    auth = getAuth(app);
  }
  db = getDatabase(app);
} else {
  console.warn(
    "Firebase env vars missing. Copy ios/.env.example → ios/.env and fill EXPO_PUBLIC_FIREBASE_*."
  );
}

export { app, auth, db };
