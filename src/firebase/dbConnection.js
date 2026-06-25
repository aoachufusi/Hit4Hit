import { ref, onValue } from "firebase/database";
import { db } from "./config.js";

/** Wait until Firebase RTDB reports connected (avoids hung get/set while offline). */
export function waitForDatabaseOnline(timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Database not initialized"));
      return;
    }
    const connectedRef = ref(db, ".info/connected");
    let unsub = () => {};
    const timer = setTimeout(() => {
      unsub();
      reject(new Error("DB_CONNECTED_TIMEOUT"));
    }, timeoutMs);
    unsub = onValue(
      connectedRef,
      (snap) => {
        if (snap.val() === true) {
          clearTimeout(timer);
          unsub();
          resolve(true);
        }
      },
      (err) => {
        clearTimeout(timer);
        unsub();
        reject(err);
      }
    );
  });
}
