import { auth, db, firebaseConfig } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut as secondarySignOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { doc, getDoc, setDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

let currentProfile = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

  const userDoc = await getDoc(doc(db, 'users', user.uid));
  const profile = userDoc.exists() ? userDoc.data() : null;

  if (!profile || profile.role !== 'admin') {
    await signOut(auth);
    window.location.href = 'login.html';
    return;
  }

  currentProfile = profile;
  document.getElementById('user-name').textContent = profile.fullName || profile.email || '';
  document.getElementById('staff-nav-link').hidden = false;

  loadVerifiedOrganizations();
});

async function loadVerifiedOrganizations() {
  const select = document.getElementById('staff-org');
  const verifiedQuery = query(collection(db, 'stakeholders'), where('verificationStatus', '==', 'verified'));
  const snap = await getDocs(verifiedQuery);

  if (snap.empty) {
    select.innerHTML = '<option value="" disabled selected>No verified organizations yet</option>';
    return;
  }

  select.innerHTML = '<option value="" disabled selected>Select an organization…</option>' +
    snap.docs.map((d) => `<option value="${d.id}">${d.data().organizationName}</option>`).join('');
}

document.getElementById('create-staff-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorBox = document.getElementById('create-staff-error');
  const successBox = document.getElementById('create-staff-success');
  errorBox.hidden = true;
  successBox.hidden = true;

  const fullName = document.getElementById('staff-name').value.trim();
  const email = document.getElementById('staff-email').value.trim();
  const password = document.getElementById('staff-password').value;
  const organizationId = document.getElementById('staff-org').value;

  const submitBtn = document.getElementById('create-staff-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating...';

  // Secondary app instance: creating a user here would otherwise sign the
  // admin out of their own session on `auth`. This keeps it isolated.
  const secondaryApp = initializeApp(firebaseConfig, 'secondary-' + Date.now());
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const newUid = credential.user.uid;

    await setDoc(doc(db, 'users', newUid), {
      fullName,
      email,
      role: 'staff',
      organizationId,
    });

    await secondarySignOut(secondaryAuth);
    await deleteApp(secondaryApp);

    successBox.textContent = `Staff account created for ${fullName}.`;
    successBox.hidden = false;
    document.getElementById('create-staff-form').reset();
    loadVerifiedOrganizations();
  } catch (error) {
    console.error('Failed to create staff account:', error);
    let message = 'Something went wrong while creating this account.';
    if (error.code === 'auth/email-already-in-use') {
      message = 'That email is already registered.';
    } else if (error.code === 'auth/weak-password') {
      message = 'Password must be at least 6 characters.';
    } else if (error.code === 'auth/invalid-email') {
      message = 'Please enter a valid email address.';
    }
    errorBox.textContent = message;
    errorBox.hidden = false;
    await deleteApp(secondaryApp);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create Staff Account';
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await signOut(auth);
  window.location.href = 'login.html';
});