"""Export only approved static marketing assets; never upload the source checkout."""
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
source = Path(__file__).resolve().parent
repo = source.parent
output = args.output.resolve()
if output == repo or repo in output.parents:
    raise SystemExit('Release output must be outside the source checkout.')
output.mkdir(parents=True, exist_ok=True)
pages = ['index.html', 'demo.html', 'contact.html', 'login.html']
scripts = ['site.css', 'site.js', 'cases.js', 'contact.js']
assets = {
    'assets/fonts/PretendardVariable-subset.woff2': 'assets/fonts/PretendardVariable-subset.woff2',
    'assets/img/apple-touch-icon.png': 'assets/img/apple-touch-icon.png',
    'assets/brand/core/THEFA_Core_Primary_Dark_web.svg': 'assets/brand/core/THEFA_Core_Primary_Dark_web.svg',
}
for name in ['business', 'checklist', 'guard', 'develop', 'research', 'talk', 'welcome']:
    assets[f'assets/mascots/{name}-320.webp'] = f'assets/img/mascots/{name}-320.webp'
subprocess.run([sys.executable, str(source/'build_demo.py'), '--production', '--output', str(output)], check=True)
for name in scripts:
    shutil.copyfile(source/name, output/name)
for destination, original in assets.items():
    target = output/destination
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(repo/original, target)
expected = set(pages + scripts) | set(assets)
actual = {p.relative_to(output).as_posix() for p in output.rglob('*') if p.is_file() and '.vercel' not in p.relative_to(output).parts}
assert actual == expected, f'Unexpected release files: {actual ^ expected}'
blocked = ['writer/fence', 'fencing_generation', 'Resource Governor', 'Fast Context', 'owned_paths', 'Work Unit', 'apiContract', '/v1/requests', '/v1/receipts', 'DATA MISMATCH', 'SEMANTIC DISAGREEMENT', 'My AVA Team', 'cloud/server', 'cloud/auth', 'schema.sql', 'service_role', 'PRIVATE KEY', 'sk-proj-', 'github_pat_']
for name in pages + scripts:
    text = (output/name).read_text(encoding='utf-8')
    assert not any(word.casefold() in text.casefold() for word in blocked), name
    if name in pages:
        assert 'noindex' not in text and '로컬 검토' not in text and '수정안' not in text and 'reviewDialog' not in text, name
home = (output/'index.html').read_text(encoding='utf-8')
assert all(home.count(f'10-2026-007229{n}') == 1 for n in range(4))
assert '특허 출원 4건' in home and '출원일 2026.04.21 · 출원 단계' in home
assert '개발 미리보기' in home and '장기 비전' in home
contact = (output/'contact.html').read_text(encoding='utf-8')
assert 'id="contactForm"' in contact and 'src="contact.js"' in contact
assert all('id="'+field+'"' in contact for field in ['cfName','cfCompany','cfEmail','cfPhone','cfTopic','cfScope','cfMessage','cfConsent'])
assert '문의가 전송되었습니다.' in contact and '문의 메일 준비하기' not in contact
assert 'action="https://formspree.io/f/mkjwwqaw" method="POST"' in contact
assert 'https://app.thefacore.com/login.html' in home
head = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
manifest = {'source_head': head, 'source_branch': subprocess.check_output(['git', '-C', str(repo), 'branch', '--show-current'], text=True).strip(), 'files': {name: hashlib.sha256((output/name).read_bytes()).hexdigest() for name in sorted(expected)}, 'customer_app_excluded': True, 'private_source_excluded': True, 'patent_numbers': [f'10-2026-007229{n}' for n in range(4)], 'patent_status': 'application', 'filing_date': '2026-04-21'}
(output.parent/'production-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'PASS: {len(expected)} allowlisted release files; four application numbers; configured Formspree POST and customer login links.')
