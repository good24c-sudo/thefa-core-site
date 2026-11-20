"""Create an isolated, exact-R7-derived candidate. No deploy, env, DB or Core writes."""
import base64
import gzip
import hashlib
import json
import pathlib
import shutil

ROOT = pathlib.Path(r'D:\THE_FA_DEV\isolated\P02_CORE_GOOGLE_LOGIN_20261120_CANDIDATE')
SOURCE = pathlib.Path(r'D:\THE_FA_DEV\isolated\P02_CUSTOMER_WORKSPACE_MODES_R7_20261119\site')
DEST = ROOT / 'site'


def digest(data, kind='sha256'):
    return hashlib.new(kind, data).hexdigest()


def checked_path(root, relative):
    parts = pathlib.PurePosixPath(relative).parts
    if not parts or any(p in ('..', '.', '') for p in parts) or '\\' in relative or ':' in relative:
        raise RuntimeError('INVALID_RELATIVE_PATH')
    target = root.joinpath(*parts)
    if target.resolve() != target.absolute() or root.resolve() not in target.resolve().parents:
        raise RuntimeError('SYMLINK_OR_OUTSIDE_ROOT')
    return target


def main():
    if DEST.exists():
        raise RuntimeError('CANDIDATE_ALREADY_EXISTS_NO_REPLAY')
    payload = json.loads(gzip.decompress(base64.b64decode((ROOT / 'AUTH_DELTA_PACKAGE.json.gz.b64').read_text())))
    deployed = payload['deployment_source']
    assert deployed['sourceRoot'] == str(SOURCE)
    assert deployed['deploymentId'] == 'dpl_EspEhBB2qc1a4MmJrM9F4AiswbrM'
    assert len(deployed['files']) == 165
    pending = {}
    for item in deployed['files']:
        rel = item['path']
        assert not any(p in ('.env', '.vercel', 'private-data', 'node_modules') for p in pathlib.PurePosixPath(rel).parts)
        data = checked_path(SOURCE, rel).read_bytes()
        if digest(data, 'sha1') != item['sha1']:
            raise RuntimeError('DEPLOYED_SOURCE_CHANGED:' + rel)
        pending[rel] = data
    before = {rel: digest(data) for rel, data in pending.items()}
    assert before['vercel.json'] == payload['expected_vercel_sha256']
    for item in payload['files']:
        rel = item['path']
        if item['before_sha256'] is not None:
            assert digest(checked_path(SOURCE, rel).read_bytes()) == item['before_sha256'], 'AUTH_BASE_CHANGED:' + rel
        elif not rel.startswith('tests/'):
            raise RuntimeError('UNEXPECTED_ADDITION')
        data = base64.b64decode(item['content_base64'], validate=True)
        assert digest(data) == item['after_sha256'], 'PAYLOAD_CORRUPTED:' + rel
        checked_path(DEST, rel)
        pending[rel] = data
    # Preserve all R7 UI routes and headers. Only the exact new callback is added.
    config = json.loads(pending['vercel.json'])
    original_routes = list(config['rewrites'])
    assert not any(x['source'] == '/auth/google/callback' for x in original_routes)
    config['rewrites'].insert(4, {'source': '/auth/google/callback', 'destination': '/api/dispatch?__customer_route=/auth/google/callback'})
    assert [x for x in config['rewrites'] if x['source'] != '/auth/google/callback'] == original_routes
    pending['vercel.json'] = (json.dumps(config, ensure_ascii=False, indent=2) + '\n').encode()
    DEST.mkdir()
    for rel, data in pending.items():
        target = checked_path(DEST, rel)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as output:
            output.write(data)
        assert digest(target.read_bytes()) == digest(data)
    # Re-read every original source after the write; the source must remain unchanged.
    assert all(digest(checked_path(SOURCE, item['path']).read_bytes(), 'sha1') == item['sha1'] for item in deployed['files'])
    changed = [rel for rel in before if digest(pending[rel]) != before[rel]]
    ui_preserved = [rel for rel in before if rel.startswith('customer-public/') and rel != 'customer-public/customer-login.js']
    assert all(before[rel] == digest(pending[rel]) for rel in ui_preserved)
    receipt = {'status': 'ISOLATED_CANDIDATE_PREPARED_NOT_DEPLOYED', 'source_deployment': deployed['deploymentId'],
               'base_git_head': payload['base_git_head'], 'source_files_verified': len(before),
               'source_unchanged_after_prepare': True, 'candidate_file_count': len(pending),
               'candidate_root': str(DEST), 'existing_files_changed': changed,
               'customer_ui_files_preserved': len(ui_preserved), 'oauth_settings_changed': False,
               'production_deployed': False, 'core_writer_changed': False,
               'files': [{'path': rel, 'sha256': digest(data)} for rel, data in sorted(pending.items())]}
    with (ROOT / 'CANDIDATE_PREPARATION_RECEIPT.json').open('x', encoding='utf-8') as output:
        json.dump(receipt, output, ensure_ascii=False, indent=2)
    print(json.dumps({k: v for k, v in receipt.items() if k != 'files'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
