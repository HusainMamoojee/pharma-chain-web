# PharmaChain blockchain layer (Hyperledger Fabric)

A permissioned Hyperledger Fabric network records the facts that must not be
editable: that a batch exists, who registered it, its expiry date, and every
custody event (transfer initiated, receipt confirmed). Firestore stays the
database for everything else (profiles, reports, scan history).

```
Web portal / Flutter app  --(Firebase login token)-->  Node.js gateway  --->  Fabric network
                                                              |
                                                          Firestore (looks up user + stakeholder)
```

Apps never talk to Fabric directly. The gateway verifies the Firebase login,
works out the user's organisation from Firestore, and signs the transaction
with that organisation's certificate.

## Folders
- `chaincode/` - the smart contract (JavaScript). Functions: `RegisterBatch`,
  `RecordCustodyEvent`, `GetBatch`, `GetBatchHistory`, `VerifyBatch`.
- `gateway/` - the Express service the apps call.

## How approval maps to the blockchain
- A verified document in the Firestore `stakeholders` collection is a stakeholder.
- An admin calls `POST /admin/stakeholders/:id/enrol`. The gateway asks Org1's
  certificate authority for a certificate with two attributes:
  `role` (the stakeholder's `organizationType`, lowercased) and `orgId`
  (the stakeholder's Firestore document ID).
- The chaincode reads those attributes. Only a `manufacturer` can register a
  batch, only the current holder can start a transfer, and only the named
  receiver can confirm receipt.
- Staff never hold keys. Their Firestore user ID is stored on each event.

## Running it locally (what we used)
Requires Docker Desktop (about 4 GB assigned to it), Node 18+, and Fabric 2.5.

1. Install Fabric tools and the test network:
```
   mkdir -p ~/fabric && cd ~/fabric
   curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh && chmod +x install-fabric.sh
   ./install-fabric.sh docker samples binary
```
2. Start the network and a channel (CA mode):
```
   cd ~/fabric/fabric-samples/test-network
   ./network.sh up createChannel -c mychannel -ca
```
3. Deploy the chaincode (adjust the path to this repo):
```
   ./network.sh deployCC -ccn pharmachain -ccp /path/to/pharma-chain-web/blockchain/chaincode -ccl javascript
```
4. Create the read-only identity the gateway uses for verify and history calls:
```
   export PATH=$PWD/../bin:$PATH
   export FABRIC_CA_CLIENT_HOME=$PWD/organizations/peerOrganizations/org1.example.com/
   fabric-ca-client register --caname ca-org1 --id.name mfr1 --id.secret mfr1pw --id.type client --id.attrs 'role=manufacturer:ecert,orgId=mfr-001:ecert' --tls.certfiles "$PWD/organizations/fabric-ca/org1/ca-cert.pem"
   fabric-ca-client enroll -u https://mfr1:mfr1pw@localhost:7054 --caname ca-org1 -M "$PWD/organizations/peerOrganizations/org1.example.com/users/mfr1@org1.example.com/msp" --tls.certfiles "$PWD/organizations/fabric-ca/org1/ca-cert.pem"
```
5. Start the gateway:
```
   cd blockchain/gateway
   npm install
   mkdir secrets   # then add firebase-service-account.json (see below)
   node server.js  # listens on port 3000
```

### Secrets (never commit these)
- `gateway/secrets/firebase-service-account.json` - generate in the Firebase
  console: Project settings -> Service accounts -> Generate new private key.
- `gateway/wallet/` - certificates the gateway creates when stakeholders are
  enrolled. If you reset the network (`./network.sh down`), delete this folder.

Set `FABRIC_NETWORK_DIR` if `fabric-samples/test-network` is not at
`~/fabric/fabric-samples/test-network`.

## Gateway API
All routes need `Authorization: Bearer <Firebase ID token>`.

| Route | Who | What |
|---|---|---|
| `GET /health` | anyone | liveness check (no token) |
| `GET /me` | staff | the organisation and role the gateway resolved |
| `GET /verify/:batchCode` | any signed-in user | Authentic / Expired / Not recognised |
| `GET /batches/:batchCode/history` | any signed-in user | custody events in order |
| `POST /batches` | manufacturer staff | register a batch (`batchCode`, `productName`, `expiryDate`) |
| `POST /batches/:batchCode/transfer` | current holder | body `toOrgId` (a verified stakeholder ID) |
| `POST /batches/:batchCode/receive` | named receiver | confirm receipt |
| `POST /admin/stakeholders/:id/enrol` | admin | create the stakeholder's blockchain identity |

## Known limitations
- Runs on a single developer machine (Fabric test network). Moving it to a server is the same steps on a hosted machine.
- One operator organisation (Org1) issues every stakeholder's identity, rather than one Fabric organisation per stakeholder. Simpler, but less decentralised.
- Staff two-factor codes are enforced in the apps only, not by the gateway.
- Existing batches created before this layer are in Firestore only, not on the ledger.