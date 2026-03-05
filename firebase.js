/**
 * MOMENTUM — firebase.js
 * Firebase Auth + Firestore sync module
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDgmvkghH7ill_tRw-d5TGgh7t5o9kLa40",
  authDomain: "momentum-habit-tracker-ccb56.firebaseapp.com",
  projectId: "momentum-habit-tracker-ccb56",
  storageBucket: "momentum-habit-tracker-ccb56.firebasestorage.app",
  messagingSenderId: "1045852198013",
  appId: "1:1045852198013:web:47feb15175d62d86f10d14"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

/* ── AUTH ── */
const signInWithGoogle = () => signInWithPopup(auth, new GoogleAuthProvider());

const signInWithEmail = (email, password) =>
  signInWithEmailAndPassword(auth, email, password);

const signUpWithEmail = async (email, password, name) => {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (name) await updateProfile(cred.user, { displayName: name });
  return cred;
};

const resetPassword = (email) => sendPasswordResetEmail(auth, email);

const logOut = () => signOut(auth);

/* ── FIRESTORE ── */
const getUserDocRef  = (uid) => doc(db, 'users', uid, 'data', 'habits');
const getTasksDocRef = (uid) => doc(db, 'users', uid, 'data', 'tasks');

const saveHabitsToCloud = async (uid, habits) => {
  try { await setDoc(getUserDocRef(uid), { habits, updatedAt: Date.now() }); }
  catch (err) { console.warn('Cloud save failed:', err); }
};

const loadHabitsFromCloud = async (uid) => {
  try {
    const snap = await getDoc(getUserDocRef(uid));
    if (snap.exists()) return snap.data().habits || [];
    return null;
  } catch (err) { console.warn('Cloud load failed:', err); return null; }
};

const subscribeToHabits = (uid, callback) =>
  onSnapshot(getUserDocRef(uid), (snap) => {
    if (snap.exists()) callback(snap.data().habits || []);
  });

const saveTasksToCloud = async (uid, tasks) => {
  try { await setDoc(getTasksDocRef(uid), { tasks, updatedAt: Date.now() }); }
  catch (err) { console.warn('Task cloud save failed:', err); }
};

const loadTasksFromCloud = async (uid) => {
  try {
    const snap = await getDoc(getTasksDocRef(uid));
    if (snap.exists()) return snap.data().tasks || [];
    return null;
  } catch (err) { console.warn('Task cloud load failed:', err); return null; }
};

export {
  auth, onAuthStateChanged,
  signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword, logOut,
  saveHabitsToCloud, loadHabitsFromCloud, subscribeToHabits,
  saveTasksToCloud, loadTasksFromCloud,
};
