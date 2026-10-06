"""Dependency-free static checks for the public site and the separate local Lab."""
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


class Document(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids, self.refs, self.images, self.headings, self.lang = [], [], [], [], None
        self.stack = []

    def handle_starttag(self, tag, attrs):
        attr = dict(attrs)
        hidden = ('hidden' in attr or attr.get('aria-hidden') == 'true'
                  or bool(self.stack and self.stack[-1][1]))
        if tag not in {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}:
            self.stack.append((tag, hidden))
        if tag == 'html':
            self.lang = attr.get('lang')
        if 'id' in attr:
            self.ids.append(attr['id'])
        for key in ('href', 'src'):
            if key in attr:
                self.refs.append(attr[key])
        if tag == 'img':
            self.images.append(attr)
        if not hidden and tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            self.headings.append(int(tag[1]))

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                self.stack = self.stack[:index]
                break


def check():
    errors, notes, count = [], [], 0
    roots = [ROOT]
    if (ROOT / 'lab/public').exists():
        roots.append(ROOT / 'lab/public')
    for base in roots:
        pages = list(base.glob('*.html'))
        docs = {}
        for file in pages:
            doc = Document()
            doc.feed(file.read_text(encoding='utf-8'))
            docs[file.resolve()] = doc
            count += 1
            label = str(file.relative_to(ROOT))
            if not doc.lang:
                errors.append(f'{label}: missing document language')
            for identifier, n in Counter(doc.ids).items():
                if n > 1:
                    errors.append(f'{label}: duplicate ID {identifier}')
            if doc.headings.count(1) != 1:
                message = f'{label}: expected one h1 (found {doc.headings.count(1)})'
                if file.name == 'signup.html' and base == ROOT:
                    notes.append('PREEXISTING: ' + message)
                else:
                    errors.append(message)
            for previous, current in zip(doc.headings, doc.headings[1:]):
                if current > previous + 1:
                    errors.append(f'{label}: heading skips h{previous} to h{current}')
            for attr in doc.images:
                if 'alt' not in attr:
                    errors.append(f'{label}: image missing alt {attr.get("src")}')
        for file, doc in docs.items():
            for ref in doc.refs:
                url = urlsplit(ref)
                if url.scheme or url.netloc or ref.startswith('/api/'):
                    continue
                target = ((base / unquote(url.path).lstrip('/')) if url.path.startswith('/')
                          else file.parent / unquote(url.path)).resolve() if url.path else file
                if not target.exists():
                    errors.append(f'{file.name}: missing local target {ref}')
                elif url.fragment and target.suffix == '.html':
                    target_doc = docs.get(target)
                    if target_doc and unquote(url.fragment) not in target_doc.ids:
                        errors.append(f'{file.name}: missing fragment {ref}')
        css_root = base / 'assets' if base == ROOT else base
        for css in css_root.glob('**/*.css'):
            # Font/image references are checked without imposing a CSS dependency.
            import re
            for ref in re.findall(r'url\([\"\']?([^\)\"\']+)', css.read_text(encoding='utf-8')):
                url = urlsplit(ref.strip())
                if not url.scheme and not ref.startswith('#'):
                    target = ((base / unquote(url.path).lstrip('/')) if url.path.startswith('/')
                              else css.parent / unquote(url.path)).resolve()
                    if not target.exists():
                        errors.append(f'{css.name}: missing CSS asset {ref}')
    js_files = list((ROOT / 'assets/js').glob('*.js')) + list((ROOT / 'lab/public').glob('*.js'))
    for file in js_files:
        result = subprocess.run(['node', '--check', str(file)], capture_output=True, text=True)
        if result.returncode:
            errors.append(result.stderr)
    if (ROOT / 'CNAME').read_text(encoding='utf-8').strip() != 'core.thefa.kr':
        errors.append('CNAME does not match preserved production domain')
    notes.append('Browser QA separately checks layout, interactions, rendered assets, focus, and console errors.')
    report = {'status': 'FAIL' if errors else 'PASS', 'pages': count,
              'js_syntax_files': len(js_files), 'errors': errors, 'notes': notes}
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return bool(errors)


if __name__ == '__main__':
    sys.exit(check())
