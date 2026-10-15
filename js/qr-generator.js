import { auth, db } from './firebase-config.js';
import { callGateway } from './gateway.js';

import {
  onAuthStateChanged,
  signOut
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';

import {
  doc,
  getDoc,
  collection,
  query,
  where,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const batchSelect = document.getElementById('batch-select');
const batchDetails = document.getElementById('batch-details');
const qrForm = document.getElementById('qr-form');
const qrError = document.getElementById('qr-error');
const qrPreview = document.getElementById('qr-preview');
const qrContainer = document.getElementById('qrcode');
const generateBtn = document.getElementById('generate-btn');

let batches = new Map();
let selectedBatch = null;
let unsubscribeBatches = null;

document.getElementById('logout-btn').addEventListener('click', async () => {
  await signOut(auth);
  window.location.href = 'login.html';
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

  try {
    const userSnapshot = await getDoc(doc(db, 'users', user.uid));
    const profile = userSnapshot.exists()
      ? userSnapshot.data()
      : null;

    if (!profile ||
        !['admin', 'staff'].includes(profile.role)) {
      await signOut(auth);
      window.location.href = 'login.html';
      return;
    }

    document.getElementById('user-name').textContent =
      profile.fullName || profile.name || profile.email || '';

    if (profile.role === 'admin') {
      document.getElementById('staff-nav-link').hidden = false;
    }

    if (profile.role === 'staff' && !profile.organizationId) {
      batchSelect.innerHTML =
        '<option value="">No organisation assigned</option>';

      showError(
        'Your account has no organisation assigned. Contact your administrator.'
      );

      generateBtn.disabled = true;
      return;
    }

    watchBatches(profile);
  } catch (error) {
    console.error('Could not initialise QR generator:', error);
    showError('Unable to load your account. Please refresh and try again.');
  }
});

function watchBatches(profile) {
  let batchesQuery;

  if (profile.role === 'admin') {
    batchesQuery = collection(db, 'batches');
  } else {
    batchesQuery = query(
      collection(db, 'batches'),
      where('organizationId', '==', profile.organizationId)
    );
  }

  unsubscribeBatches?.();

  unsubscribeBatches = onSnapshot(
    batchesQuery,
    (snapshot) => {
      const previousValue = batchSelect.value;

      batches.clear();
      batchSelect.innerHTML = '';

      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Choose a batch';
      batchSelect.appendChild(placeholder);

      snapshot.forEach((batchDoc) => {
        const data = batchDoc.data();

        // Only generate codes for active, blockchain-registered batches.
        if (data.status !== 'active' || data.onLedger !== true) {
          return;
        }

        batches.set(batchDoc.id, {
          id: batchDoc.id,
          productName: data.productName || 'Unnamed medication',
          quantity: data.quantity,
          expiryDate: data.expiryDate || 'Not recorded',
          status: data.status,
          onLedger: data.onLedger
        });

        const option = document.createElement('option');
        option.value = batchDoc.id;
        option.textContent =
          `${data.productName || 'Unnamed medication'} — ${batchDoc.id}`;

        batchSelect.appendChild(option);
      });

      if (batches.size === 0) {
        placeholder.textContent = 'No eligible batches available';
        showError(
          'No active, blockchain-registered batches are currently available.'
        );
        generateBtn.disabled = true;
        return;
      }

      generateBtn.disabled = false;
      clearError();

      if (batches.has(previousValue)) {
        batchSelect.value = previousValue;
      }

      updateBatchDetails();
    },
    (error) => {
      console.error('Batch subscription failed:', error);
      showError('Unable to retrieve batches. Check your access permissions.');
    }
  );
}

batchSelect.addEventListener('change', () => {
  updateBatchDetails();

  qrPreview.style.display = 'none';
  qrContainer.replaceChildren();
  selectedBatch = null;
});

function updateBatchDetails() {
  const batch = batches.get(batchSelect.value);

  if (!batch) {
    batchDetails.textContent = '';
    return;
  }

  batchDetails.textContent =
    `Batch: ${batch.id} | Product: ${batch.productName} | ` +
    `Quantity: ${batch.quantity ?? 'Not recorded'} | ` +
    `Expiry: ${batch.expiryDate}`;
}

qrForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();

  const batch = batches.get(batchSelect.value);

  if (!batch) {
    showError('Please select a valid medication batch.');
    return;
  }

  if (typeof QRCode === 'undefined') {
    showError('The QR library failed to load. Check your internet connection.');
    return;
  }

  // Ask the ledger (through the gateway) whether this batch really exists.
  generateBtn.disabled = true;
  try {
    const check = await callGateway(`/verify/${encodeURIComponent(batch.id)}`);
    if (!check.exists) {
      showError('This batch is not on the blockchain ledger, so no QR code was generated.');
      return;
    }
  } catch (error) {
    showError(`Could not check the ledger: ${error.message}`);
    return;
  } finally {
    generateBtn.disabled = false;
  }

  selectedBatch = batch;

  // The app scans this text and asks the gateway to verify it against the ledger.
  const payload = batch.id;

  qrContainer.replaceChildren();

  try {
    new QRCode(qrContainer, {
      text: payload,
      width: 240,
      height: 240,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });

    document.getElementById('qr-payload').textContent =
      `Batch reference: ${batch.id}`;

    qrPreview.style.display = 'block';
  } catch (error) {
    console.error('QR generation failed:', error);
    showError('Unable to generate this QR code.');
  }
});

document.getElementById('download-btn').addEventListener('click', () => {
  if (!selectedBatch) {
    showError('Generate a QR code first.');
    return;
  }

  const canvas = qrContainer.querySelector('canvas');
  const image = qrContainer.querySelector('img');

  let imageUrl;

  if (canvas) {
    imageUrl = canvas.toDataURL('image/png');
  } else if (image) {
    imageUrl = image.src;
  } else {
    showError('The QR code is not ready to download.');
    return;
  }

  const link = document.createElement('a');
  link.href = imageUrl;
  link.download = `PharmaChain-${selectedBatch.id}-QR.png`;

  document.body.appendChild(link);
  link.click();
  link.remove();
});

function showError(message) {
  qrError.textContent = message;
}

function clearError() {
  qrError.textContent = '';
}