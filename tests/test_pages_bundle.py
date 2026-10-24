"""Public artifact boundaries: no document fixtures, tests, logs or evidence."""
import importlib.util
from pathlib import Path
import re
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pages', ROOT / 'scripts/build_pages.py')
pages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pages)


class PagesBundleTest(unittest.TestCase):
    def test_runtime_assets_and_no_private_files(self):
        with tempfile.TemporaryDirectory() as temp:
            result = pages.build(Path(temp) / 'site')
            files = [f.relative_to(result).as_posix() for f in result.rglob('*') if f.is_file()]
            self.assertIn('index.html', files)
            self.assertIn('js/xy_caps_engine.js', files)
            self.assertIn('fileInput', (result / 'index.html').read_text(encoding='utf-8'))
            self.assertNotIn('file_upload', (result / 'index.html').read_text(encoding='utf-8'))
            self.assertTrue(all(f in ('index.html', '.nojekyll') or
                                f.startswith('js/') and f.endswith('.js') or
                                f.startswith('css/') and f.endswith('.css') for f in files))

    def test_html_references_resolve_in_bundle(self):
        with tempfile.TemporaryDirectory() as temp:
            result = pages.build(Path(temp) / 'site')
            html = (result / 'index.html').read_text(encoding='utf-8')
            refs = re.findall(r'(?:src|href)="([^"#]+)"', html)
            self.assertTrue(refs)
            for ref in refs:
                self.assertFalse(ref.startswith(('/', 'http:', 'https:')))
                self.assertTrue((result / ref.split('?')[0]).is_file(), ref)

    def test_existing_files_are_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp)
            witness = target / 'keep.txt'
            witness.write_text('prior custody')
            with self.assertRaises(ValueError):
                pages.build(target)
            self.assertEqual(witness.read_text(), 'prior custody')

    def test_repository_and_source_directories_are_rejected(self):
        for target in [ROOT, ROOT / 'js/nested', ROOT / 'css/nested', ROOT / '.git/nested', ROOT / 'prototype/nested', ROOT / 'tests/nested']:
            with self.assertRaises(ValueError):
                pages.build(target)


if __name__ == '__main__':
    unittest.main()
