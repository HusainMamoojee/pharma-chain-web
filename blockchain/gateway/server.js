'use strict';

const { enrolStakeholder, listEnrolled } = require('./enrol');

const express = require('express');
const cors = require('cors');
const { evaluate, submit } = require('./fabric');

const { requireSignedIn, requireStaff, requireAdmin, getStakeholder } = require('./auth');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.json());

// Read-only calls need some identity; VerifyBatch/GetBatch/GetBatchHistory check no role.
const READER = 'mfr-001';

const str = (v) => (v === undefined || v === null ? '' : String(v));

function messageOf(err) {
    if (err && Array.isArray(err.details) && err.details.length > 0) {
        return err.details.map((d) => d.message).join('; ');
    }
    return err && err.message ? err.message : String(err);
}

function route(handler) {
    return async (req, res) => {
        try {
            res.json(await handler(req));
        } catch (err) {
            console.error(messageOf(err));
            res.status(err.status || 400).json({ error: messageOf(err) });
        }
    };
}

app.get('/health', (req, res) => res.json({ ok: true }));

// Who does the gateway think I am? Useful for testing logins.
app.get('/me', requireStaff, route(async (req) => req.user));

// Any signed-in user (patients too) can verify a batch and see its journey.
app.get('/verify/:batchCode', requireSignedIn, route(async (req) =>
    JSON.parse(await evaluate(READER, 'VerifyBatch', req.params.batchCode))));

app.get('/batches/:batchCode/history', requireSignedIn, route(async (req) =>
    JSON.parse(await evaluate(READER, 'GetBatchHistory', req.params.batchCode))));




// Which organisations already have a ledger identity (admin only).
app.get('/admin/enrolled', requireAdmin, route(async () => ({ ids: await listEnrolled() })));


// Staff of a verified organisation. Their organisation and role come from Firestore, not the request.
app.post('/batches', requireStaff, route(async (req) => {
    const { batchCode, productName, expiryDate } = req.body;
    return JSON.parse(await submit(req.user.orgId, 'RegisterBatch',
        str(batchCode), str(productName), str(expiryDate), req.user.uid));
}));

app.post('/batches/:batchCode/transfer', requireStaff, route(async (req) => {
    const toOrgId = str(req.body.toOrgId);
    const target = await getStakeholder(toOrgId);
    if (!target || !target.verified) {
        throw new Error('Destination is not a verified stakeholder');
    }
    return JSON.parse(await submit(req.user.orgId, 'RecordCustodyEvent',
        req.params.batchCode, 'Transfer initiated', toOrgId, req.user.uid));
}));

app.post('/batches/:batchCode/receive', requireStaff, route(async (req) =>
    JSON.parse(await submit(req.user.orgId, 'RecordCustodyEvent',
        req.params.batchCode, 'Receipt confirmed', '', req.user.uid))));

// Admin approves a stakeholder -> it gets a blockchain identity.
app.post('/admin/stakeholders/:id/enrol', requireAdmin, route(async (req) => {
    const org = await getStakeholder(req.params.id);
    if (!org) {
        throw new Error('Stakeholder not found');
    }
    if (!org.verified) {
        throw new Error('Stakeholder is not verified');
    }
    return enrolStakeholder(org.id, org.role);
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PharmaChain gateway listening on port ${PORT}`));