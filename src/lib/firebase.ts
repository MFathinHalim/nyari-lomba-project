import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, updateDoc, serverTimestamp, arrayUnion, arrayRemove, onSnapshot } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// PERBAIKAN: Menggunakan getFirestore standar tanpa id kustom agar mengarah ke database (default)
export const db = getFirestore(app);
export const auth = getAuth(app);

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Ensure user document exists upon login
export async function ensureUserDocument(user: any) {
  if (!user) return;
  const userRef = doc(db, 'users', user.uid);
  try {
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        userId: user.uid, 
        email: user.email,
        displayName: user.displayName || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        sharedCompetitions: [] // Menyiapkan array kosong untuk menampung bookmark lomba
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
  }
}

export const subscribeToUserDoc = (userId: string, callback: (data: any) => void) => {
  const userRef = doc(db, 'users', userId);
  return onSnapshot(userRef, (docSnap) => {
    if (docSnap.exists()) {
      callback(docSnap.data());
    }
  });
};

/**
 * FEATURE SIMPEL: Menyimpan atau menghapus objek data kompetisi utuh hasil scraping ke Firestore.
 * Menggunakan arrayUnion untuk menambah objek dan arrayRemove untuk menghapus objek.
 */
export const toggleSaveCompetition = async (userId: string, competitionData: any, isCurrentlySaved: boolean) => {
  const userRef = doc(db, 'users', userId);
  try {
    // Gunakan setDoc + merge: true sebagai pengganti updateDoc
    await setDoc(userRef, {
      sharedCompetitions: isCurrentlySaved 
        ? arrayRemove(competitionData) 
        : arrayUnion(competitionData),
      updatedAt: serverTimestamp() // Sekalian update timestamp-nya
    }, { merge: true }); // <--- Ini kuncinya agar tidak eror "No document to update"
    
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
  }
};

/**
 * Melacak kompetisi yang dibagikan oleh user (jika dibutuhkan)
 */
export const logSharedCompetition = async (userId: string, competitionId: string) => {
  const userRef = doc(db, 'users', userId);
  try {
    await updateDoc(userRef, {
      sharedCompetitions: arrayUnion(competitionId)
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
  }
};

export const logInWithGoogle = async () => {
  const provider = new GoogleAuthProvider();
  try {
    const result = await signInWithPopup(auth, provider);
    await ensureUserDocument(result.user);
    return result.user;
  } catch (error) {
    console.error("Login failed:", error);
    throw error;
  }
};

export const logOut = async () => {
  return signOut(auth);
};