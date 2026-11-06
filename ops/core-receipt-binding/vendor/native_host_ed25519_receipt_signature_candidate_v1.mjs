/**
 * Isolated P02 native host public-key receipt signature verifier.
 *
 * No private key is embedded, generated or persisted here. Trusted native host
 * configuration must inject a keyring of reviewed, non-revoked ED25519 public
 * keys. User/AI chat JSON MUST NOT select or provide trusted keys.
 *
 * A successful signature proves only a cryptographic host key possession and
 * exact receipt/payload binding. It does NOT establish representative writer
 * grant, authenticated native session, atomic nonce consumption, Core
 * write-admission, registration/dispatched Work Unit, or actual completion.
 *
 * Reuse the EXISTING Founder Live canonical JSON and Python receipt hash body.
 */
import { createHash, verify as verifyEd25519, KeyObject } from 'node:crypto';
import { canonicalJson } from './edge/thefa-founder-live-ingress-v1/contract.mjs';

export const CAPABILITY = 'THE_FA_NATIVE_HOST_ED25519_RECEIPT_SIGNATURE_CANDIDATE';
export const PROOF_SCHEMA = 'THE_FA_NATIVE_HOST_RECEIPT_SIGNATURE_V1';
export const HOST_ISSUER = 'THE_FA_AUTHENTICATED_HOST';
export const DOMAIN = 'THE_FA_NATIVE_HOST_RECEIPT_SIGNATURE_V1\n';
const HASH = /^sha256:[a-f0-9]{64}$/;
const NONCE = /^[a-f0-9]{64}$/;
const KID = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,95}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/;
const RECEIPT_KEYS = Object.freeze([
  'representative_person_id','scope','payload_hash','source_ref',
  'receipt_id','nonce','issued_at','expires_at','receipt_hash',
]);
const PROOF_KEYS = Object.freeze([
  'schema','issuer','algorithm','key_id','receipt_id','receipt_hash',
  'scope','payload_hash','source_ref','representative_person_id',
  'nonce_hash','issued_at','expires_at','actor_ref','signature',
]);

function reject(code) {
  return {
    capability: CAPABILITY,
    decision: 'RECONCILE_REQUIRED',
    reason: code,
    cryptographic_signature_verified: false,
    host_key_trust_verified: false,
    representative_writer_grant_verified: false,
    native_session_verified: false,
    nonce_consumed: false,
    work_unit_registered: false,
    work_unit_dispatched: false,
    write_allowed: false,
    replay_allowed: false,
  };
}

function keysExactly(x, fields) {
  if (x === null || typeof x !== 'object' || Array.isArray(x)
      || Object.getPrototypeOf(x) !== Object.prototype) return false;
  const a = Object.keys(x).sort();
  const b = [...fields].sort();
  return a.length === b.length && a.every((n, i) => n === b[i]);
}
function sha(v) {
  return createHash('sha256').update(v).digest('hex');
}
function withinWindow(issued, expires, now) {
  if (!TIME.test(issued) || !TIME.test(expires)) return false;
  const a = Date.parse(issued), b = Date.parse(expires);
  return Number.isFinite(a) && Number.isFinite(b)
    && b > a && b - a <= 300_000 && a <= now && now < b;
}
function unsigned(proof) {
  const { signature, ...claims } = proof;
  return claims;
}

export function verifyNativeHostReceiptSignature({
  receipt,
  proof,
  expectedActorRef,
  expectedScope,
  expectedPayloadHash,
  expectedSourceRef,
  trustedKeyring,
  now,
} = {}) {
  if (!keysExactly(receipt, RECEIPT_KEYS) || !keysExactly(proof, PROOF_KEYS)) {
    return reject('EXACT_RECEIPT_AND_PROOF_SCHEMA_REQUIRED');
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    return reject('TRUSTED_NATIVE_TIME_REQUIRED');
  }
  if (!(trustedKeyring instanceof Map)) {
    return reject('TRUSTED_HOST_PUBLIC_KEYRING_REQUIRED');
  }
  if (![expectedActorRef, expectedScope, expectedPayloadHash, expectedSourceRef]
    .every(s => typeof s === 'string' && s.length > 0 && s.length <= 700)) {
    return reject('TRUSTED_NATIVE_BINDING_REQUIRED');
  }
  if (!HASH.test(expectedPayloadHash)
      || !HASH.test(receipt.receipt_hash) || !NONCE.test(receipt.nonce)
      || !UUID.test(receipt.receipt_id)
      || !KID.test(proof.key_id)
      || !SIGNATURE.test(proof.signature)) {
    return reject('RECEIPT_OR_SIGNATURE_SHAPE_INVALID');
  }
  if (proof.schema !== PROOF_SCHEMA
      || proof.algorithm !== 'Ed25519'
      || proof.issuer !== HOST_ISSUER) {
    return reject('UNTRUSTED_ISSUER_OR_SIGNATURE_ALGORITHM');
  }
  if (receipt.scope !== expectedScope
      || receipt.payload_hash !== expectedPayloadHash
      || receipt.source_ref !== expectedSourceRef
      || proof.actor_ref !== expectedActorRef
      || proof.scope !== expectedScope
      || proof.payload_hash !== expectedPayloadHash
      || proof.source_ref !== expectedSourceRef) {
    return reject('RECEIPT_COMMAND_OR_ACTOR_BINDING_MISMATCH');
  }
  if (proof.receipt_id !== receipt.receipt_id
      || proof.receipt_hash !== receipt.receipt_hash
      || proof.representative_person_id !== receipt.representative_person_id
      || proof.issued_at !== receipt.issued_at
      || proof.expires_at !== receipt.expires_at
      || proof.nonce_hash !== sha(receipt.nonce)) {
    return reject('SIGNED_RECEIPT_CLAIMS_MISMATCH');
  }
  if (!withinWindow(receipt.issued_at, receipt.expires_at, now.getTime())) {
    return reject('RECEIPT_TTL_OR_CLOCK_INVALID');
  }
  const safeBody = {};
  for (const k of RECEIPT_KEYS) {
    if (k !== 'receipt_hash') safeBody[k] = receipt[k];
  }
  let expectedReceiptHash, message;
  try {
    expectedReceiptHash = 'sha256:' + sha(canonicalJson(safeBody));
    message = DOMAIN + canonicalJson(unsigned(proof));
  } catch {
    return reject('INVALID_JSON_OR_CANONICALIZATION');
  }
  if (expectedReceiptHash !== receipt.receipt_hash) {
    return reject('RECEIPT_CANONICAL_HASH_MISMATCH');
  }
  const entry = trustedKeyring.get(proof.key_id);
  if (!entry || typeof entry !== 'object' || entry.revoked !== false
      || !(entry.publicKey instanceof KeyObject)
      || entry.publicKey.type !== 'public'
      || entry.publicKey.asymmetricKeyType !== 'ed25519'
      || !Array.isArray(entry.allowedScopes)
      || !entry.allowedScopes.includes(expectedScope)) {
    return reject('NATIVE_HOST_TRUST_ANCHOR_NOT_VALID');
  }
  if (!withinWindow(entry.notBefore, entry.notAfter, now.getTime())) {
    // Key policy period uses a 5-minute max per native grant to restrict
    // exposure. For longer-lived public keys the host rotates short-lived
    // authorization windows, not client-controlled expiry.
    return reject('HOST_KEY_AUTHORIZATION_WINDOW_INVALID');
  }
  let sig;
  try {
    sig = Buffer.from(proof.signature, 'base64url');
    if (sig.length !== 64 || sig.toString('base64url') !== proof.signature) {
      return reject('NONCANONICAL_ED25519_SIGNATURE');
    }
  } catch {
    return reject('INVALID_ED25519_SIGNATURE_ENCODING');
  }
  let good;
  try {
    good = verifyEd25519(null, Buffer.from(message, 'utf8'),
                          entry.publicKey, sig);
  } catch {
    return reject('ED25519_VERIFICATION_FAILURE');
  }
  if (good !== true) return reject('ED25519_SIGNATURE_REJECTED');
  return {
    capability: CAPABILITY,
    decision: 'CRYPTOGRAPHIC_HOST_SIGNATURE_VERIFIED_ONLY',
    cryptographic_signature_verified: true,
    host_key_trust_verified: true,
    verified_public_key_id: proof.key_id,
    receipt_commitment: receipt.receipt_hash,
    representative_writer_grant_verified: false,
    native_session_verified: false,
    nonce_consumed: false,
    work_unit_registered: false,
    work_unit_dispatched: false,
    write_allowed: false,
    replay_allowed: false,
    next_required_checks: [
      'AUTHENTICATED_NATIVE_SESSION_AND_REPRESENTATIVE_WRITER_GRANT',
      'SERVER_SIDE_ORIGINAL_NONCE_ATOMIC_CONSUMPTION',
      'CURRENT_CORE_WRITER_FENCE_AND_EXISTING_WORK_UNIT_PREWRITE',
    ],
  };
}
