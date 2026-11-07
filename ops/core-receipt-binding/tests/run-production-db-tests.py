"""Only the fixed local Docker QA container. No service DB connections.

Retains a uniquely named TEST_ONLY database for inspection. The fixture's native
proofs/fence helper are synthetic; only the Current/lease checker is reused verbatim.
"""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess
import uuid

ROOT = Path(__file__).resolve().parent.parent
CONTAINER = 'thefa-customer-consumer-qa-20261106'
DB = 'consumer_qa_' + uuid.uuid4().hex[:10]
cmd = ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-At']

def query(sql):
    r = subprocess.run(cmd, input=sql, capture_output=True, timeout=30)
    if r.returncode:
        raise RuntimeError(r.stderr.decode('utf-8', errors='replace'))
    return r.stdout.decode('utf-8')

subprocess.run(['docker', 'exec', CONTAINER, 'createdb', '-U', 'postgres', DB], check=True, capture_output=True)
for path in [ROOT/'tests/production-db-fixture.sql', ROOT/'tests/production-current-helper.sql', ROOT/'sql/customer_production_receipt_v1.sql', ROOT/'tests/production-db-tests.sql']:
    output = query(path.read_bytes())
    (ROOT/'tests'/(path.stem+'.log')).write_text(output, encoding='utf-8')

# Race two distinct DB connections against one issued receipt. Exactly one wins.
setup = b"""CREATE TABLE public.test_concurrency_policy(p jsonb);
INSERT INTO public.test_concurrency_policy SELECT public.test_policy('concurrency');
SELECT thefa_customer_production_v1.enroll_policy_v1(p) FROM public.test_concurrency_policy;
SET ROLE thefa_core_receipt_issuer_v1;
RESET ROLE;
SELECT p FROM public.test_concurrency_policy;"""
lines = query(setup).splitlines()
p = json.loads(next(x for x in reversed(lines) if x.startswith('{')))
nonce = hashlib.sha256(b'concurrency').hexdigest()
register = f"BEGIN;SET LOCAL ROLE thefa_core_receipt_issuer_v1;SELECT thefa_customer_production_v1.register_v1('{p['receipt_id']}'::uuid,'{nonce}');COMMIT;"
query(register.encode())
consume = f"BEGIN;SET LOCAL ROLE thefa_core_receipt_consumer_v1;SELECT thefa_customer_production_v1.consume_v1('{p['receipt_id']}'::uuid,'{nonce}','{p['payload_hash']}','{p['binding']['idempotency_key']}');COMMIT;"
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    raced = list(pool.map(query, [consume.encode(), consume.encode()]))
receipts = [json.loads(next(line for line in result.splitlines() if line.startswith('{'))) for result in raced]
assert sum(r['verified'] is True for r in receipts) == 1, receipts
query(b"SELECT public.test_assert('two-connections-one-consumer',true);")
summary = query(b"SELECT jsonb_build_object('tests',count(*),'passed',count(*) FILTER(WHERE passed)) FROM public.test_results;")
result = json.loads(summary.strip())
result.update(database=DB, container=CONTAINER, fixture_only=True, cryptographic_authentication_proven=False,
              sql_sha256=hashlib.sha256((ROOT/'sql/customer_production_receipt_v1.sql').read_bytes()).hexdigest(),
              concurrency_decisions=[r['decision'] for r in receipts])
(ROOT/'tests/production-db-results.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result))
