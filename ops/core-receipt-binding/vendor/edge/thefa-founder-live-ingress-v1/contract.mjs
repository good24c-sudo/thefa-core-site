export const WORKSPACE_REF = 'P02:19_v1:THE_FA_CORE_V2';
export const CONTRACT_NAME = 'founder_live_ingress_contract_v1';
export const DOWNSTREAM_CAPABILITIES = Object.freeze([
  'THE_FA_MOBILE_DEVELOPMENT_ENTRY_V1',
  'THE_FA_WORK_UNIT_API_V2',
]);

const KEY_RE = /^[0-9a-f]{24}$/;
const ACTOR_RE = /^actor_sha256:[0-9a-f]{64}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const REQUEST_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;
const PROTECTED_RE = /(?:^|[^a-z0-9])(?:main|production|database|db|secrets?|oauth|billing|dns|acl|bulk[\s_-]*delete)(?:$|[^a-z0-9])/i;
const SENSITIVE_RE = /(?:bearer|password|passwd|cookie|session|secret|token|oauth|authorization|api[\s_-]*key|private[\s_-]*key|credential|gh[pousr]_|github_pat_|sk-|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]*\.|-----BEGIN|[a-z][a-z0-9+.-]*:\/\/[^\s/]*@)/i;
const EMAIL_RE = /[^\s@]+@[^\s@]+/;
const OPERATION_CLASSES = new Set([
  'READ', 'ANALYSIS', 'DEVELOPMENT', 'TEST', 'DOCUMENTATION', 'SAFE_BRANCH',
]);

function reject(code) {
  throw new TypeError(code);
}

function isRecord(value) {
  return value !== null && typeof value === 'object'
    && (Object.getPrototypeOf(value) === Object.prototype
      || Object.getPrototypeOf(value) === null);
}

// Only JSON data is accepted. Build object text explicitly so integer-like keys
// also obey lexical sorting. Cycles, sparse arrays and non-JSON values fail closed.
export function canonicalJson(value) {
  const ancestors = new Set();
  function encode(item) {
    if (item === null) return 'null';
    if (typeof item === 'string' || typeof item === 'boolean') {
      return JSON.stringify(item);
    }
    if (typeof item === 'number' && Number.isFinite(item)) {
      return JSON.stringify(item);
    }
    if (!Array.isArray(item) && !isRecord(item)) reject('INVALID_JSON');
    if (ancestors.has(item)) reject('INVALID_JSON');
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        if (Object.keys(item).length !== item.length) reject('INVALID_JSON');
        const entries = [];
        for (let index = 0; index < item.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor || !('value' in descriptor)) reject('INVALID_JSON');
          entries.push(encode(descriptor.value));
        }
        if (Object.getOwnPropertySymbols(item).length) reject('INVALID_JSON');
        return '[' + entries.join(',') + ']';
      }
      const keys = Reflect.ownKeys(item);
      if (keys.some(key => typeof key !== 'string')) reject('INVALID_JSON');
      return '{' + keys.sort().map(key => {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor.enumerable || !('value' in descriptor)) reject('INVALID_JSON');
        return JSON.stringify(key) + ':' + encode(descriptor.value);
      }).join(',') + '}';
    } finally {
      ancestors.delete(item);
    }
  }
  return encode(value);
}

function inspectInput(value) {
  if (typeof value === 'string') {
    const normalized = value.normalize('NFKC');
    if (PROTECTED_RE.test(normalized) || SENSITIVE_RE.test(normalized)
        || /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/.test(normalized.replace(/[\n\r\t]/g, ''))) {
      reject('PROTECTED_OR_SENSITIVE_INPUT');
    }
  } else if (Array.isArray(value)) {
    value.forEach(inspectInput);
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      inspectInput(key);
      inspectInput(item);
    }
  }
}

// Returns a detached projection, never approval or execution authority.
// action may be omitted by a caller that already routed to SUBMIT.
export function validateSubmit(input) {
  if (!isRecord(input)) reject('INVALID_SUBMIT');
  const data = JSON.parse(canonicalJson(input));
  inspectInput(data);
  if (data.action !== undefined && data.action !== 'SUBMIT') reject('INVALID_ACTION');
  if (data.workspace_ref !== WORKSPACE_REF) reject('INVALID_WORKSPACE');
  if (typeof data.actor_ref !== 'string' || !ACTOR_RE.test(data.actor_ref)) reject('INVALID_ACTOR');
  if (typeof data.request_id !== 'string' || !REQUEST_RE.test(data.request_id)) reject('INVALID_REQUEST_ID');
  if (typeof data.goal !== 'string' || !data.goal.trim()
      || data.goal.length > 4000) reject('INVALID_GOAL');
  if (!isRecord(data.source) || typeof data.source.sha !== 'string'
      || !SHA_RE.test(data.source.sha)
      || typeof data.source.channel !== 'string' || !data.source.channel.trim()) {
    reject('INVALID_SOURCE');
  }
  const capabilities = data.downstream_capabilities;
  if (!Array.isArray(capabilities) || capabilities.length !== DOWNSTREAM_CAPABILITIES.length
      || new Set(capabilities).size !== DOWNSTREAM_CAPABILITIES.length
      || !DOWNSTREAM_CAPABILITIES.every(item => capabilities.includes(item))) {
    reject('INVALID_DOWNSTREAM_CAPABILITIES');
  }
  if (data.operation_class !== undefined && !OPERATION_CLASSES.has(data.operation_class)) {
    reject('INVALID_OPERATION_CLASS');
  }
  return {
    action: 'SUBMIT',
    actor_ref: data.actor_ref,
    workspace_ref: WORKSPACE_REF,
    request_id: data.request_id,
    goal: data.goal,
    source: { sha: data.source.sha, channel: data.source.channel },
    downstream_capabilities: [...DOWNSTREAM_CAPABILITIES],
    ...(data.operation_class === undefined ? {} : { operation_class: data.operation_class }),
  };
}

// Identity intentionally excludes the payload. A storage-owning caller must
// reject conflicting payloads that reuse an identity; this helper stores nothing.
export async function requestKey(input) {
  const data = validateSubmit(input);
  const identity = {
    contract: CONTRACT_NAME,
    actor_ref: data.actor_ref,
    workspace_ref: data.workspace_ref,
    request_id: data.request_id,
  };
  const bytes = new TextEncoder().encode(canonicalJson(identity));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0'))
    .join('').slice(0, 24);
}

export function validateReceiptId(receiptId) {
  if (typeof receiptId !== 'string' || !KEY_RE.test(receiptId)) reject('INVALID_RECEIPT_ID');
  return receiptId;
}

export function artifactPath(key) {
  return 'ops/core-v2/founder-live-inbox/' + validateReceiptId(key) + '.md';
}

export function dcZeroPaths(key) {
  const id = validateReceiptId(key);
  return {
    job_branch: 'dc-zero/jobs/' + id,
    job_path: 'ops/dev-write-continuity/dc-zero-jobs/' + id + '.json',
    claim_branch: 'dc-zero/claims/' + id,
    error_branch: 'dc-zero/errors/' + id,
    receipt_branch: 'dc-zero/receipts/' + id,
    receipt_path: 'ops/dev-write-continuity/dc-zero-receipts/' + id + '.json',
  };
}

function safeLabel(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128
      || !/^[A-Za-z0-9][A-Za-z0-9_.:/ -]*$/.test(value)
      || SENSITIVE_RE.test(value) || EMAIL_RE.test(value)) return null;
  return value;
}

function safePath(value) {
  if (typeof value !== 'string' || value.length > 512
      || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(value)
      || value.split('/').some(part => part === '.' || part === '..')
      || SENSITIVE_RE.test(value) || EMAIL_RE.test(value)) return null;
  return value;
}

function normalizeTests(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const test of value.slice(0, 50)) {
    if (typeof test === 'string') {
      const label = safeLabel(test);
      if (label !== null) result.push(label);
    } else if (isRecord(test)) {
      const name = safeLabel(test.name);
      const status = ['PASS', 'FAIL', 'SKIP', 'ERROR'].includes(test.status) ? test.status : null;
      if (name !== null && status !== null) result.push({ name, status });
    }
  }
  return result;
}

// Whitelist and type-check every field, including nested test rows. No raw
// receipt objects or arbitrary nested metadata are copied into the projection.
export function normalizeTerminalReceipt(receipt) {
  if (!isRecord(receipt)) reject('INVALID_RECEIPT');
  return {
    local_state: safeLabel(receipt.local_state),
    success: receipt.success === true,
    changed_paths: Array.isArray(receipt.changed_paths)
      ? [...new Set(receipt.changed_paths.slice(0, 200).map(safePath).filter(value => value !== null))]
      : [],
    scope_ok: receipt.scope_ok === true,
    failure_class: safeLabel(receipt.failure_class),
    error_type: safeLabel(receipt.error_type),
    model: safeLabel(receipt.model),
    seconds: typeof receipt.seconds === 'number' && Number.isFinite(receipt.seconds)
      && receipt.seconds >= 0 ? receipt.seconds : null,
    rolled_back: receipt.rolled_back === true,
    tests: normalizeTests(receipt.tests),
    final_decision: safeLabel(receipt.final_decision),
    auto_replay_allowed: false,
  };
}
