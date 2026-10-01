import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { doc, getDoc, collection, query, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const params = new URLSearchParams(window.location.search);
const batchCode = params.get('code');

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

  document.getElementById('user-name').textContent = profile.fullName || profile.email || '';

  if (profile.role === 'admin') {
    document.getElementById('staff-nav-link').hidden = false;
  }

  if (!batchCode) {
    document.getElementById('batch-title').textContent = 'No batch specified';
    return;
  }

  loadBatch(batchCode, profile);
});

async function loadBatch(code, profile) {
  const batchRef = doc(db, 'batches', code);
  const batchSnap = await getDoc(batchRef);

  if (!batchSnap.exists()) {
    document.getElementById('batch-title').textContent = 'Batch not found';
    document.getElementById('batch-subtitle').textContent = `No batch with code "${code}" exists.`;
    return;
  }

  const data = batchSnap.data();

  // Staff can only view batches belonging to their own organization.
  if (profile.role === 'staff' && data.organizationId !== profile.organizationId) {
    document.getElementById('batch-title').textContent = 'Access denied';
    document.getElementById('batch-subtitle').textContent = 'This batch belongs to a different organization.';
    return;
  }

  document.getElementById('batch-title').textContent = code;
  document.getElementById('batch-subtitle').textContent = data.productName || '';

  const statusPill = document.getElementById('batch-status-pill');
  statusPill.textContent = data.status || 'active';

  document.getElementById('info-product').textContent = data.productName || '—';
  document.getElementById('info-quantity').textContent = data.quantity ?? '—';
  document.getElementById('info-expiry').textContent = data.expiryDate || '—';
  document.getElementById('info-created').textContent = formatDateTime(data.createdAt);

  loadOrganizationName(data.organizationId);
  loadMintedByName(data.mintedBy);
  watchCustodyEvents(code);
}

async function loadOrganizationName(organizationId) {
  const field = document.getElementById('info-org');
  if (!organizationId) {
    field.textContent = '—';
    return;
  }
  const orgSnap = await getDoc(doc(db, 'stakeholders', organizationId));
  field.textContent = orgSnap.exists() ? orgSnap.data().organizationName : organizationId;
}

async function loadMintedByName(uid) {
  const field = document.getElementById('info-minted-by');
  if (!uid) {
    field.textContent = '—';
    return;
  }
  const userSnap = await getDoc(doc(db, 'users', uid));
  field.textContent = userSnap.exists() ? (userSnap.data().fullName || userSnap.data().email) : uid;
}

function watchCustodyEvents(code) {
  const eventsQuery = query(
    collection(db, 'batches', code, 'custody_events'),
    orderBy('timestamp', 'asc')
  );

  onSnapshot(eventsQuery, (snap) => {
    renderCustodyTimeline(snap.docs);
  }, (error) => console.error('custody_events query failed:', error));
}

function renderCustodyTimeline(docs) {
  const timeline = document.getElementById('custody-timeline');

  if (docs.length === 0) {
    timeline.innerHTML = '<p class="batch-empty">No custody events recorded.</p>';
    return;
  }

  timeline.innerHTML = docs.map((d) => {
    const data = d.data();
    return `
      <div class="custody-event">
        <div class="custody-event-title">${data.event || 'Event'}</div>
        <div class="custody-event-meta">${formatDateTime(data.timestamp)}</div>
      </div>
    `;
  }).join('');
}

function formatDateTime(timestamp) {
  if (!timestamp?.toDate) return '—';
  return timestamp.toDate().toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  await signOut(auth);
  window.location.href = 'login.html';
});