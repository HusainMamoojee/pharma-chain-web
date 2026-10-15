

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { doc, getDoc, collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";


onAuthStateChanged(auth, async (user) => {{
    if(!user){
        window.location.href = "login.html";
        return;
    }
}



const userDoc = await getDoc(doc(db, "users", user.uid));
const profile = userDoc.exists() ? userDoc.data() : null;

if (!profile || (profile.role !== 'admin' && profile.role !== 'staff')) {
    await signOut(auth);
    window.location.href = 'login.html';
    return;
  }

document.getElementById('user-name').textContent = profile.name;


if (profile.role === 'admin') {
    document.getElementById('staff-nav-link').hidden = false;
}


 watchBatches(profile);
});

function watchBatches(profile) {
  const batchesQuery = profile.role === 'admin'
    ? collection(db, 'batches')
    : query(collection(db, 'batches'), where('organizationId', '==', profile.organizationId));

  onSnapshot(batchesQuery, (snap) => {
    renderBatches(snap.docs);
  }, (error) => console.error('batches query failed:', error));
}

function renderBatches(docs) {
  const list = document.getElementById('batch-list');

  if (docs.length === 0) {
    list.innerHTML = '<p class="batch-empty">No batches found.</p>';
    return;
  }

  const rows = docs.map((d) => {
    const data = d.data();
    return `
      <a class="batch-row" href="batch-detail.html?code=${encodeURIComponent(d.id)}">
        <span class="batch-code-cell">${d.id}</span>
        <span>${data.productName || '—'}</span>
        <span>${data.quantity ?? '—'}</span>
        <span><span class="status-pill">${data.status || 'active'}</span></span>
        <span>${formatDate(data.createdAt)}</span>
      </a>
    `;
  }).join('');

  list.innerHTML = `
    <div class="panel batch-table">
      <div class="batch-row batch-row-head">
        <span>Batch Code</span>
        <span>Product</span>
        <span>Qty</span>
        <span>Status</span>
        <span>Minted</span>
      </div>
      ${rows}
    </div>
  `;
}

function formatDate(timestamp) {
  if (!timestamp?.toDate) return '—';
  return timestamp.toDate().toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  await signOut(auth);
  window.location.href = 'login.html';
});