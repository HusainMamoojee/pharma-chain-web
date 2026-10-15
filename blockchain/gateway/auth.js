'use strict';

const { auth, db } = require('./firebase');

const ROLES = ['manufacturer', 'distributor', 'pharmacy'];

function httpError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

async function verifiedToken(req) {
    const match = (req.get('Authorization') || '').match(/^Bearer (.+)$/);
    if (!match) {
        throw httpError(401, 'Missing login token');
    }
    try {
        return await auth.verifyIdToken(match[1]);
    } catch (e) {
         console.error('Token check failed:', e.code, e.message);
        throw httpError(401, 'Invalid or expired login token');
    }
}

async function getUserDoc(uid) {
    const snap = await db.collection('users').doc(uid).get();
    return snap.exists ? snap.data() : null;
}

// Looks up a stakeholder; the organisation type becomes the blockchain role.
async function getStakeholder(id) {
    const snap = await db.collection('stakeholders').doc(id).get();
    if (!snap.exists) {
        return null;
    }
    const d = snap.data();
    return {
        id,
        name: d.organizationName,
        role: String(d.organizationType || '').trim().toLowerCase(),
        verified: d.verificationStatus === 'verified',
    };
}

function wrap(check) {
    return async (req, res, next) => {
        try {
            await check(req);
            next();
        } catch (err) {
            res.status(err.status || 500).json({ error: err.message });
        }
    };
}

// Any signed-in user (patients included)
const requireSignedIn = wrap(async (req) => {
    const decoded = await verifiedToken(req);
    req.uid = decoded.uid;
});

// Staff of a verified stakeholder organisation
const requireStaff = wrap(async (req) => {
    const decoded = await verifiedToken(req);
    const user = await getUserDoc(decoded.uid);
    if (!user || user.role !== 'staff' || !user.organizationId) {
        throw httpError(403, 'Not a staff account');
    }
    const org = await getStakeholder(user.organizationId);
    if (!org) {
        throw httpError(403, 'Your organisation is not registered');
    }
    if (!org.verified) {
        throw httpError(403, 'Your organisation is not verified');
    }
    if (!ROLES.includes(org.role)) {
        throw httpError(403, 'Unknown organisation type');
    }
    req.uid = decoded.uid;
    req.user = { uid: decoded.uid, orgId: org.id, role: org.role, orgName: org.name };
});

// Admin accounts only
const requireAdmin = wrap(async (req) => {
    const decoded = await verifiedToken(req);
    const user = await getUserDoc(decoded.uid);
    if (!user || user.role !== 'admin') {
        throw httpError(403, 'Admins only');
    }
    req.uid = decoded.uid;
});

module.exports = { requireSignedIn, requireStaff, requireAdmin, getStakeholder, ROLES };