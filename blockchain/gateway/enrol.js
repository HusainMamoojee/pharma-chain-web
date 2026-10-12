'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { NETWORK_DIR, ORG1, WALLET_DIR } = require('./fabric');

const run = promisify(execFile);

const CA_BIN = path.join(NETWORK_DIR, '..', 'bin', 'fabric-ca-client');
const CA_TLS = path.join(NETWORK_DIR, 'organizations/fabric-ca/org1/ca-cert.pem');
const ROLES = ['manufacturer', 'distributor', 'pharmacy'];
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

async function exists(p) {
    try {
        await fs.access(p);
        return true;
    } catch (e) {
        return false;
    }
}

async function caRun(args) {
    try {
        await run(CA_BIN, args, { env: { ...process.env, FABRIC_CA_CLIENT_HOME: ORG1 } });
    } catch (e) {
        const text = String(e.stderr || e.message).trim().split('\n').pop();
        throw new Error(`Certificate authority error: ${text}`);
    }
}

// Creates a blockchain identity for an approved stakeholder organisation.
// The certificate carries role (organisation type) and orgId (Firestore document ID).
async function enrolStakeholder(stakeholderId, role) {
    if (!ID_RE.test(stakeholderId)) {
        throw new Error('Invalid stakeholder ID');
    }
    if (!ROLES.includes(role)) {
        throw new Error(`Invalid organisation type: ${role}`);
    }

    const dir = path.join(WALLET_DIR, stakeholderId);
    const msp = path.join(dir, 'msp');
    if (await exists(path.join(msp, 'signcerts', 'cert.pem'))) {
        return { enrolled: true, alreadyEnrolled: true };
    }

    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const secretFile = path.join(dir, 'enroll-secret.txt');
    let secret;

    if (await exists(secretFile)) {
        secret = (await fs.readFile(secretFile, 'utf8')).trim();   // registered earlier, enrol failed
    } else {
        secret = crypto.randomBytes(16).toString('hex');
        await caRun([
            'register', '--caname', 'ca-org1',
            '--id.name', stakeholderId, '--id.secret', secret, '--id.type', 'client',
            '--id.attrs', `role=${role}:ecert,orgId=${stakeholderId}:ecert`,
            '--tls.certfiles', CA_TLS,
        ]);
        await fs.writeFile(secretFile, secret, { mode: 0o600 });
    }

    await caRun([
        'enroll', '-u', `https://${stakeholderId}:${secret}@localhost:7054`,
        '--caname', 'ca-org1', '-M', msp, '--tls.certfiles', CA_TLS,
    ]);

    return { enrolled: true, alreadyEnrolled: false };
}

module.exports = { enrolStakeholder };