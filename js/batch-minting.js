import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import {  setDoc, addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

let currentUser = null;
let currentProfile = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

  const userDoc = await getDoc(doc(db, 'users', user.uid));
  const profile = userDoc.exists() ? userDoc.data() : null;

  if (!profile || (profile.role !== 'admin' && profile.role !== 'staff')) {
    await signOut(auth);
    window.location.href = 'login.html';
    return;
  }

    if (profile.role === 'admin') {
    document.getElementById('staff-nav-link').hidden = false;
  }


if (profile.role !== 'staff' || !profile.organizationId) {
  const message = profile.role !== 'staff'
    ? 'Batch minting is only available to organization staff accounts.'
    : 'No organization assigned to this account — contact your administrator.';
  document.getElementById('form-error').textContent = message;
  document.getElementById('form-error').hidden = false;
  document.getElementById('mint-btn').disabled = true;
  return;
}

  currentUser = user;
  currentProfile = profile;
  document.getElementById('user-name').textContent = profile.fullName || profile.email || '';
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await signOut(auth);
  window.location.href = 'login.html';
});


document.getElementById('mint-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const errorBox = document.getElementById('form-error');
  const successBox = document.getElementById('form-success');
  errorBox.hidden = true;
  successBox.hidden = true;

  const batchCode = document.getElementById('batch-code').value.trim();
  const productName = document.getElementById('product-name').value.trim();
  const quantity = Number(document.getElementById('quantity').value);
  const expiryDate = document.getElementById('expiry-date').value;

  setMintLoading(true);

  try {
    // Batch code is the doc ID, so it must be unique — check first.
    const batchRef = doc(db, 'batches', batchCode);
    const existing = await getDoc(batchRef);
    if (existing.exists()) {
      errorBox.textContent = `Batch code "${batchCode}" already exists. Use a different code.`;
      errorBox.hidden = false;
      setMintLoading(false);
      return;
    }

    await setDoc(batchRef, {
      productName,
      quantity,
      expiryDate,
      organizationId: currentProfile.organizationId,
      status: 'active',
      mintedBy: currentUser.uid,
      createdAt: serverTimestamp(),
    });

    // First custody event — the batch's trail starts here.
    await addDoc(collection(db, 'batches', batchCode, 'custody_events'), {
      event: 'minted',
      actorUid: currentUser.uid,
      timestamp: serverTimestamp(),
    });

    // So the dashboard's Recent Activity feed picks this up too.
    await addDoc(collection(db, 'audit_log'), {
      organizationId: currentProfile.organizationId,
      message: `Batch ${batchCode} (${productName}) minted`,
      timestamp: serverTimestamp(),
    });

    successBox.textContent = `Batch "${batchCode}" minted successfully.`;
    successBox.hidden = false;
    document.getElementById('mint-form').reset();
  } catch (error) {
    console.error('Mint failed:', error);
    errorBox.textContent = 'Something went wrong while minting this batch. Please try again.';
    errorBox.hidden = false;
  } finally {
    setMintLoading(false);
  }
});

function setMintLoading(isLoading) {
  document.getElementById('mint-btn').disabled = isLoading;
  document.getElementById('mint-btn-text').hidden = isLoading;
  document.getElementById('mint-btn-spinner').hidden = !isLoading;
}