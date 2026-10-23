'use strict';

const { Contract } = require('fabric-contract-api');

const ROLES = ['manufacturer', 'distributor', 'pharmacy'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class PharmaChainContract extends Contract {

    // ---------- helpers (names starting with _ are not callable from outside) ----------

    // Deterministic time: taken from the transaction itself, never from the machine clock.
    _now(ctx) {
        const ts = ctx.stub.getTxTimestamp();
        const secs = (ts.seconds && typeof ts.seconds.toNumber === 'function')
            ? ts.seconds.toNumber()
            : Number(ts.seconds);
        return new Date(secs * 1000).toISOString();
    }

    // Who is calling? Read from the caller's certificate attributes (set by the CA at approval).
    _caller(ctx) {
        const role = ctx.clientIdentity.getAttributeValue('role');
        const orgId = ctx.clientIdentity.getAttributeValue('orgId');
        if (!role || !orgId) {
            throw new Error('Caller has no role/orgId attributes - stakeholder not approved');
        }
        if (!ROLES.includes(role)) {
            throw new Error(`Unknown role: ${role}`);
        }
        return { role, orgId };
    }

    _checkCode(batchCode) {
        if (!batchCode || batchCode.length > 64) {
            throw new Error('batchCode is required and must be 64 characters or fewer');
        }
    }

    _batchKey(ctx, batchCode) {
        return ctx.stub.createCompositeKey('batch', [batchCode]);
    }

    async _loadBatch(ctx, batchCode) {
        const data = await ctx.stub.getState(this._batchKey(ctx, batchCode));
        if (!data || data.length === 0) {
            return null;
        }
        return JSON.parse(data.toString());
    }

    async _saveBatch(ctx, batch) {
        await ctx.stub.putState(this._batchKey(ctx, batch.batchCode), Buffer.from(JSON.stringify(batch)));
    }

    async _addEvent(ctx, batchCode, action, caller, staffUid, toOrgId) {
        const event = {
            docType: 'custodyEvent',
            batchCode,
            action,
            orgId: caller.orgId,
            role: caller.role,
            staffUid: staffUid || '',
            toOrgId: toOrgId || '',
            txId: ctx.stub.getTxID(),
            timestamp: this._now(ctx),
        };
        const key = ctx.stub.createCompositeKey('custody', [batchCode, ctx.stub.getTxID()]);
        await ctx.stub.putState(key, Buffer.from(JSON.stringify(event)));
    }

    // ---------- contract functions ----------

    // Only an approved manufacturer can register a batch.
    async RegisterBatch(ctx, batchCode, productName, expiryDate, staffUid) {
        const caller = this._caller(ctx);
        if (caller.role !== 'manufacturer') {
            throw new Error('Only a manufacturer can register a batch');
        }
        this._checkCode(batchCode);
        if (!productName) {
            throw new Error('productName is required');
        }
        if (!DATE_RE.test(expiryDate)) {
            throw new Error('expiryDate must be in the form YYYY-MM-DD');
        }
        if (await this._loadBatch(ctx, batchCode)) {
            throw new Error(`Batch ${batchCode} already exists`);
        }

        const batch = {
            docType: 'batch',
            batchCode,
            productName,
            expiryDate,
            manufacturerOrgId: caller.orgId,
            holderOrgId: caller.orgId,
            pendingToOrgId: '',
            status: 'Registered',
            registeredBy: staffUid || '',
            registeredAt: this._now(ctx),
        };
        await this._saveBatch(ctx, batch);
        await this._addEvent(ctx, batchCode, 'Batch registered', caller, staffUid, '');
        return JSON.stringify(batch);
    }

    // action is 'Transfer initiated' (by the current holder) or 'Receipt confirmed' (by the receiver).
    async RecordCustodyEvent(ctx, batchCode, action, toOrgId, staffUid) {
        const caller = this._caller(ctx);
        this._checkCode(batchCode);
        const batch = await this._loadBatch(ctx, batchCode);
        if (!batch) {
            throw new Error(`Batch ${batchCode} does not exist`);
        }

        if (action === 'Transfer initiated') {
            if (batch.holderOrgId !== caller.orgId) {
                throw new Error('Only the current holder can transfer this batch');
            }
            if (batch.pendingToOrgId) {
                throw new Error('A transfer is already in progress');
            }
            if (!toOrgId || toOrgId === caller.orgId) {
                throw new Error('toOrgId must be a different organisation');
            }
            batch.pendingToOrgId = toOrgId;
            batch.status = 'In transit';
        } else if (action === 'Receipt confirmed') {
            if (!batch.pendingToOrgId || batch.pendingToOrgId !== caller.orgId) {
                throw new Error('This batch is not waiting to be received by your organisation');
            }
            batch.holderOrgId = caller.orgId;
            batch.pendingToOrgId = '';
            batch.status = 'Received';
        } else {
            throw new Error(`Unknown action: ${action}`);
        }

        await this._saveBatch(ctx, batch);
        await this._addEvent(ctx, batchCode, action, caller, staffUid, toOrgId);
        return JSON.stringify(batch);
    }

    async GetBatch(ctx, batchCode) {
        this._checkCode(batchCode);
        const batch = await this._loadBatch(ctx, batchCode);
        if (!batch) {
            throw new Error(`Batch ${batchCode} does not exist`);
        }
        return JSON.stringify(batch);
    }

    async GetBatchHistory(ctx, batchCode) {
        this._checkCode(batchCode);
        const iterator = await ctx.stub.getStateByPartialCompositeKey('custody', [batchCode]);
        const events = [];
        let result = await iterator.next();
        while (!result.done) {
            events.push(JSON.parse(result.value.value.toString()));
            result = await iterator.next();
        }
        await iterator.close();
        events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        return JSON.stringify(events);
    }

    // Used by the patient app. Does not throw if the batch is unknown.
    async VerifyBatch(ctx, batchCode) {
        this._checkCode(batchCode);
        const batch = await this._loadBatch(ctx, batchCode);
        if (!batch) {
            return JSON.stringify({ exists: false, status: 'Not recognised' });
        }
        const today = this._now(ctx).slice(0, 10);
        const expired = batch.expiryDate < today;
        return JSON.stringify({
            exists: true,
            status: expired ? 'Expired' : 'Authentic',
            batchCode: batch.batchCode,
            productName: batch.productName,
            expiryDate: batch.expiryDate,
            manufacturerOrgId: batch.manufacturerOrgId,
            holderOrgId: batch.holderOrgId,
            custodyStatus: batch.status,
        });
    }
}

module.exports = PharmaChainContract;