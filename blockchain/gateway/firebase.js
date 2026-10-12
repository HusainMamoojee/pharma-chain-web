'use strict';

const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

// The key file is a secret. Never commit it.
const serviceAccount = require('./secrets/firebase-service-account.json');

initializeApp({ credential: cert(serviceAccount) });

module.exports = { auth: getAuth(), db: getFirestore() };