import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { doc, getDoc, collection, query, where, onSnapshot, updateDoc,addDoc,serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

let currentProfile = null;
let currentFilter = 'all';
let latestDocs = [];

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

  currentProfile = profile;
  document.getElementById('user-name').textContent = profile.fullName || profile.email || '';

  if (profile.role !== 'admin') {
    // Staff get a read-only directory — hide the filter tabs and queue actions.
    document.getElementById('filter-tabs').hidden = true;
    document.getElementById('page-subtitle').textContent = 'Verified organizations on the PharmaChain network.';
    
  } else{
    document.getElementById('add-stakeholder-btn').hidden = false;
    document.getElementById('staff-nav-link').hidden = false;
  }

  watchStakeholders(profile.role);
});

function watchStakeholders(role) {
  const baseQuery = role === 'admin'
    ? collection(db, 'stakeholders')
    : query(collection(db, 'stakeholders'), where('verificationStatus', '==', 'verified'));

  onSnapshot(baseQuery, (snap) => {
    latestDocs = snap.docs;
    renderStakeholders();
  }, (error) => console.error('stakeholders query failed:', error));
}

function renderStakeholders() {
  const grid = document.getElementById('stakeholder-grid');
  const visible = currentFilter === 'all'
    ? latestDocs
    : latestDocs.filter((d) => d.data().verificationStatus === currentFilter);

  if (visible.length === 0) {
    grid.innerHTML = '<p class="stakeholder-empty">No stakeholders found.</p>';
    return;
  }

  grid.innerHTML = visible.map((d) => {
    const data = d.data();
    const status = data.verificationStatus || 'pending';
    const isAdmin = currentProfile.role === 'admin';

    return `
      <div class="panel stakeholder-card">
        <div class="stakeholder-top">
          <div>
            <div class="stakeholder-name">${data.organizationName || 'Unnamed organization'}</div>
            <div class="stakeholder-code">${d.id}</div>
          </div>
          <span class="status-badge badge-${status}">${status}</span>
        </div>
        <div class="stakeholder-meta">
          <div class="stakeholder-meta-row"><span>Contact</span><b>${data.contactEmail || '—'}</b></div>
          <div class="stakeholder-meta-row"><span>Type</span><b>${data.organizationType || '—'}</b></div>
        </div>
        ${isAdmin && status === 'pending' ? `
          <div class="stakeholder-actions">
            <button class="btn-primary approve-btn" data-id="${d.id}">Approve</button>
            <button class="btn-outline reject-btn" data-id="${d.id}">Reject</button>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  document.getElementById('add-stakeholder-btn').addEventListener('click', () => {
  document.getElementById('add-stakeholder-panel').hidden = false;
});

document.getElementById('add-stakeholder-cancel').addEventListener('click', () => {
  document.getElementById('add-stakeholder-panel').hidden = true;
  document.getElementById('add-stakeholder-form').reset();
  document.getElementById('add-stakeholder-error').hidden = true;
});

document.getElementById('add-stakeholder-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorBox = document.getElementById('add-stakeholder-error');
  errorBox.hidden = true;

  const organizationName = document.getElementById('org-name').value.trim();
  const contactEmail = document.getElementById('org-email').value.trim();
  const organizationType = document.getElementById('org-type').value.trim();
  const verificationStatus = document.getElementById('org-status').value;

  const submitBtn = document.getElementById('add-stakeholder-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving...';

  try {
    await addDoc(collection(db, 'stakeholders'), {
      organizationName,
      contactEmail,
      organizationType,
      verificationStatus,
      createdBy: currentProfile ? currentProfile.email : null,
      createdAt: serverTimestamp(),
    });

    document.getElementById('add-stakeholder-panel').hidden = true;
    document.getElementById('add-stakeholder-form').reset();
  } catch (error) {
    console.error('Failed to add stakeholder:', error);
    errorBox.textContent = 'Something went wrong while saving. Please try again.';
    errorBox.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save';
  }
});

  if (currentProfile.role === 'admin') {
    grid.querySelectorAll('.approve-btn').forEach((btn) => {
      btn.addEventListener('click', () => setVerification(btn.dataset.id, 'verified'));
    });
    grid.querySelectorAll('.reject-btn').forEach((btn) => {
      btn.addEventListener('click', () => setVerification(btn.dataset.id, 'rejected'));
    });
  }
}

async function setVerification(stakeholderId, newStatus) {
  try {
    await updateDoc(doc(db, 'stakeholders', stakeholderId), { verificationStatus: newStatus });
  } catch (error) {
    console.error('Failed to update stakeholder status:', error);
  }
}

document.getElementById('filter-tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-filter]');
  if (!tab) return;
  currentFilter = tab.dataset.filter;
  document.querySelectorAll('#filter-tabs span').forEach((s) => s.classList.remove('active'));
  tab.classList.add('active');
  renderStakeholders();
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await signOut(auth);
  window.location.href = 'login.html';
});