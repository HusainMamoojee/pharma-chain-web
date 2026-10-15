import { auth, db } from './firebase-config.js';
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const form = document.getElementById('login-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const errorBox = document.getElementById('error-message');
const loginBtn = document.getElementById('login-btn');
const btnText = document.getElementById('btn-text');
const btnSpinner = document.getElementById('btn-spinner');

function setLoading(isLoading) {
  loginBtn.disabled = isLoading;
  btnText.hidden = isLoading;
  btnSpinner.hidden = !isLoading;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function hideError() {
  errorBox.hidden = true;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();
  setLoading(true);

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const user = credential.user;

    // Check the user's role in Firestore — only admin/staff (with an org)
    // should reach the web portal. Adjust this once manufacturer/distributor
    // roles are formally added to the schema.
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    const role = userDoc.exists() ? userDoc.data().role : null;

    if (role !== 'admin' && role !== 'staff') {
      await auth.signOut();
      showError('This account does not have admin portal access.');
      setLoading(false);
      return;
    }

    window.location.href = 'index.html';
  } catch (err) {
    let message = 'Login failed. Please try again.';
    if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
      message = 'Incorrect email or password.';
    } else if (err.code === 'auth/invalid-email') {
      message = 'Please enter a valid email address.';
    }
    showError(message);
    setLoading(false);
  }
});