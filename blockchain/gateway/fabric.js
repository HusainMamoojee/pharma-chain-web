'use strict';

const grpc = require('@grpc/grpc-js');
const { connect, signers } = require('@hyperledger/fabric-gateway');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const CHANNEL = 'mychannel';
const CHAINCODE = 'pharmachain';

const NETWORK_DIR = process.env.FABRIC_NETWORK_DIR
    || path.join(os.homedir(), 'fabric/fabric-samples/test-network');
const ORG1 = path.join(NETWORK_DIR, 'organizations/peerOrganizations/org1.example.com');
const WALLET_DIR = path.join(__dirname, 'wallet');

const PEER_ENDPOINT = 'localhost:7051';
const PEER_HOST_ALIAS = 'peer0.org1.example.com';

// Test identities from earlier. 'mfr-001' is also used for read-only calls.
const LEGACY = {
    'mfr-001': path.join(ORG1, 'users/mfr1@org1.example.com/msp'),
    'dist-001': path.join(ORG1, 'users/dist1@org1.example.com/msp'),
};

let client;

async function getClient() {
    if (!client) {
        const tlsRootCert = await fs.readFile(
            path.join(ORG1, 'peers/peer0.org1.example.com/tls/ca.crt'));
        client = new grpc.Client(
            PEER_ENDPOINT,
            grpc.credentials.createSsl(tlsRootCert),
            { 'grpc.ssl_target_name_override': PEER_HOST_ALIAS });
    }
    return client;
}

async function loadIdentity(orgId) {
    const msp = LEGACY[orgId] || path.join(WALLET_DIR, orgId, 'msp');
    let credentials;
    try {
        credentials = await fs.readFile(path.join(msp, 'signcerts', 'cert.pem'));
    } catch (e) {
        throw new Error('This organisation has no blockchain identity yet - an admin must enrol it');
    }
    const keyDir = path.join(msp, 'keystore');
    const keyFiles = await fs.readdir(keyDir);
    const privateKey = crypto.createPrivateKey(
        await fs.readFile(path.join(keyDir, keyFiles[0])));
    return {
        identity: { mspId: 'Org1MSP', credentials },
        signer: signers.newPrivateKeySigner(privateKey),
    };
}

async function withContract(orgId, work) {
    const { identity, signer } = await loadIdentity(orgId);
    const gateway = connect({
        client: await getClient(),
        identity,
        signer,
        evaluateOptions: () => ({ deadline: Date.now() + 5000 }),
        endorseOptions: () => ({ deadline: Date.now() + 15000 }),
        submitOptions: () => ({ deadline: Date.now() + 5000 }),
        commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
    });
    try {
        const contract = gateway.getNetwork(CHANNEL).getContract(CHAINCODE);
        return await work(contract);
    } finally {
        gateway.close();
    }
}

const decoder = new TextDecoder();

function evaluate(orgId, fn, ...args) {
    return withContract(orgId, async (contract) =>
        decoder.decode(await contract.evaluateTransaction(fn, ...args)));
}

function submit(orgId, fn, ...args) {
    return withContract(orgId, async (contract) =>
        decoder.decode(await contract.submitTransaction(fn, ...args)));
}

module.exports = { evaluate, submit, NETWORK_DIR, ORG1, WALLET_DIR };