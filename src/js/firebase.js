import { initializeApp } from 'firebase/app';
import { browserLocalPersistence, connectAuthEmulator, getAuth, getRedirectResult, GoogleAuthProvider,
  setPersistence, signInWithPopup, signInWithRedirect, signOut } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore, memoryLocalCache } from 'firebase/firestore';

const env = import.meta.env;
export const emulator = env.MODE === 'emulator' && ['127.0.0.1','localhost'].includes(location.hostname);
const config = emulator ? {
  projectId: 'demo-espolio-regina', authDomain: 'demo-espolio-regina.firebaseapp.com',
  apiKey: 'fake-api-key', appId: '1:123:web:demo'
} : {
  apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID, appId: env.VITE_FIREBASE_APP_ID
};
export const configured = Object.values(config).every(Boolean);
export const firebaseApp = configured ? initializeApp(config) : null;
export const auth = configured ? getAuth(firebaseApp) : null;
export const db = configured ? initializeFirestore(firebaseApp, {localCache: memoryLocalCache()}) : null;
if (emulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings: true});
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

export async function login(redirect = false) {
  await setPersistence(auth, browserLocalPersistence);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({prompt: 'select_account'});
  return redirect ? signInWithRedirect(auth, provider) : signInWithPopup(auth, provider);
}
export const finishLogin = () => getRedirectResult(auth);
export const logout = () => signOut(auth);

export const aiOptions = {
  verified: !emulator && env.VITE_AI_SPARK_VERIFIED === 'true',
  siteKey: env.VITE_APPCHECK_SITE_KEY || '',
  model: env.VITE_AI_MODEL || ''
};
