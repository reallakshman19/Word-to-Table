"""Stage only the launched prototype runtime, without private sources or tests."""
import argparse
from pathlib import Path
import shutil


def build(output):
    repo = Path(__file__).resolve().parents[1]
    source = repo / 'prototype'
    target = Path(output).resolve()
    protected = {'prototype', 'js', 'css', 'scripts', 'tests', 'Docs', '.git'}
    if target == repo or repo in target.parents and target.parts[len(repo.parts)] in protected:
        raise ValueError('Choose a separate staging directory')
    if target.exists() and any(target.iterdir()):
        raise ValueError('Staging directory must be empty; existing files are preserved')
    target.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source / 'index.html', target / 'index.html')
    (target / '.nojekyll').write_text('', encoding='utf-8')
    for folder, suffix in (('js', '.js'), ('css', '.css')):
        for file in (source / folder).rglob('*'):
            if not file.is_file() or file.suffix != suffix:
                continue
            destination = target / file.relative_to(source)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file, destination)
    return target


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    print(build(args.output))
