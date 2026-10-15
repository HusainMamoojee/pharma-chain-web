import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { doc, getDoc, collection, query, where, onSnapshot, orderBy, limit } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";


console.log('dashboard.js loaded');


document.getElementById('logout-btn').addEventListener('click', async () => {
  await signOut(auth);
  window.location.href = 'login.html';
});

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

  initDashboard(profile);
});

function initDashboard(profile) {
  document.getElementById('user-name').textContent = profile.fullName || profile.email || '';

  if (profile.role === 'admin') {
    document.getElementById('staff-nav-link').hidden = false;
    watchAdminStats();
  } else {
    watchStaffStats(profile.organizationId);
  }
}

function setLabels(l1, l2, l3) {
  document.getElementById('stat-1-label').textContent = l1;
  document.getElementById('stat-2-label').textContent = l2;
  document.getElementById('stat-3-label').textContent = l3;
}

function watchStaffStats(organizationId) {
      if (!organizationId) {
    document.getElementById('stat-1-value').textContent = '0';
    document.getElementById('stat-2-value').textContent = '0';
    document.getElementById('stat-3-value').textContent = '0';
    document.getElementById('activity-list').innerHTML =
      '<p class="activity-empty">No organization assigned to this account yet — contact your administrator.</p>';
    return; // stop here — don't attempt the Firestore queries at all
  }
  setLabels('Active Batches', 'Pending Dispatches', 'Recent Alerts');

  const batchesQuery = query(collection(db, 'batches'), where('organizationId', '==', organizationId));
  onSnapshot(batchesQuery, (snap) => {
    document.getElementById('stat-1-value').textContent = snap.size;
  });

  const dispatchesQuery = query(
    collection(db, 'dispatches'),
    where('organizationId', '==', organizationId),
    where('status', '==', 'pending')
  );
  onSnapshot(dispatchesQuery, (snap) => {
    document.getElementById('stat-2-value').textContent = snap.size;
  });

  const activityQuery = query(
    collection(db, 'audit_log'),
    where('organizationId', '==', organizationId),
    orderBy('timestamp', 'desc'),
    limit(5)
  );
  onSnapshot(activityQuery, (snap) => {
    document.getElementById('stat-3-value').textContent = snap.size;
    renderActivity(snap.docs);
  });
}

function watchAdminStats() {
  setLabels('Total Active Batches', 'Orgs Pending Verification', 'Recent Alerts');

  onSnapshot(collection(db, 'batches'), (snap) => {
    document.getElementById('stat-1-value').textContent = snap.size;
  });

  const pendingOrgsQuery = query(collection(db, 'stakeholders'), where('verificationStatus', '==', 'pending'));
  onSnapshot(pendingOrgsQuery, (snap) => {
    document.getElementById('stat-2-value').textContent = snap.size;
  });

  const activityQuery = query(collection(db, 'audit_log'), orderBy('timestamp', 'desc'), limit(5));
  onSnapshot(activityQuery, (snap) => {
    document.getElementById('stat-3-value').textContent = snap.size;
    renderActivity(snap.docs);
  });
}

function renderActivity(docs) {
  const list = document.getElementById('activity-list');
  if (docs.length === 0) {
    list.innerHTML = '<p class="activity-empty">No recent activity.</p>';
    return;
  }
  list.innerHTML = docs.map((d) => {
    const data = d.data();
    return `<div class="activity-row"><span>${data.message || data.action || 'Activity logged'}</span><span>${formatTime(data.timestamp)}</span></div>`;
  }).join('');
}

function formatTime(timestamp) {
  if (!timestamp?.toDate) return '';
  return timestamp.toDate().toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}