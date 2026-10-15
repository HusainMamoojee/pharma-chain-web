import { auth, db } from './firebase-config.js';
import { callGateway } from './gateway.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { doc, getDoc, collection, query, where, onSnapshot, updateDoc, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

let currentProfile = null;
let currentFilter = 'all';
let latestDocs = [];

let enrolledIds = new Set();
let enrolledLoaded = false;

const grid = document.getElementById('stakeholder-grid');

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
  } else {
    document.getElementById('add-stakeholder-btn').hidden = false;
    document.getElementById('staff-nav-link').hidden = false;
  }

  watchStakeholders(profile.role);
   if (profile.role === 'admin') refreshEnrolled();
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
            ${isAdmin && status === 'verified' && enrolledLoaded ? `
          <div class="stakeholder-actions">
            ${enrolledIds.has(d.id)
              ? '<span class="ledger-enrolled">✓ Enrolled on ledger</span>'
              : `<button class="btn-outline enrol-btn" data-id="${d.id}">Enrol on ledger</button>`}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

// Creates the stakeholder's blockchain identity (safe to run more than once).
// Asks the gateway which organisations already have a ledger identity.
async function refreshEnrolled() {
  try {
    const result = await callGateway('/admin/enrolled');
    enrolledIds = new Set(result.ids);
    enrolledLoaded = true;
  } catch (error) {
    console.error('Could not load ledger enrolments:', error);
  }
  renderStakeholders();
}

// Creates the stakeholder's blockchain identity (safe to run more than once).
async function enrolOnLedger(stakeholderId) {
  const result = await callGateway(`/admin/stakeholders/${encodeURIComponent(stakeholderId)}/enrol`, { method: 'POST' });
  await refreshEnrolled();
  return result;
}
async function setVerification(stakeholderId, newStatus) {
  try {
    await updateDoc(doc(db, 'stakeholders', stakeholderId), { verificationStatus: newStatus });
  } catch (error) {
    console.error('Failed to update stakeholder status:', error);
    alert('Could not update this stakeholder. Please try again.');
    return;
  }

  if (newStatus === 'verified') {
    try {
      await enrolOnLedger(stakeholderId);
    } catch (error) {
      console.error('Ledger enrolment failed:', error);
      alert(`Approved, but the ledger identity could not be created: ${error.message}\n\nUse "Enrol on ledger" on the card to try again.`);
    }
  }
}

// One click handler for all card buttons (instead of re-attaching on every render).
grid.addEventListener('click', async (e) => {
  if (!currentProfile || currentProfile.role !== 'admin') return;

  const approve = e.target.closest('.approve-btn');
  const reject = e.target.closest('.reject-btn');
  const enrol = e.target.closest('.enrol-btn');

  if (approve) {
    approve.disabled = true;
    await setVerification(approve.dataset.id, 'verified');
  } else if (reject) {
    reject.disabled = true;
    await setVerification(reject.dataset.id, 'rejected');
  } else if (enrol) {
    enrol.disabled = true;
    enrol.textContent = 'Working...';
    try {
      const result = await enrolOnLedger(enrol.dataset.id);
      alert(result.alreadyEnrolled ? 'This organisation already has a ledger identity.' : 'Ledger identity created.');
    } catch (error) {
      console.error('Ledger enrolment failed:', error);
      alert(`Could not create the ledger identity: ${error.message}`);
    }
    enrol.disabled = false;
    enrol.textContent = 'Enrol on ledger';
  }
});

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

  let newId = null;
  try {
    const ref = await addDoc(collection(db, 'stakeholders'), {
      organizationName,
      contactEmail,
      organizationType,
      verificationStatus,
      createdBy: currentProfile ? currentProfile.email : null,
      createdAt: serverTimestamp(),
    });
    newId = ref.id;

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

  if (newId && verificationStatus === 'verified') {
    try {
      await enrolOnLedger(newId);
    } catch (error) {
      console.error('Ledger enrolment failed:', error);
      alert(`Saved, but the ledger identity could not be created: ${error.message}\n\nUse "Enrol on ledger" on the card to try again.`);
    }
  }
});

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