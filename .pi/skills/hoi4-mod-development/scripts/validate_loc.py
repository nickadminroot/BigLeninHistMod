#!/usr/bin/env python3
"""
Validate HOI4 localization files for translation submods.
Checks: BOM, language header, key format, empty values, duplicates.

Usage:
  python validate_loc.py                    # validate all files
  python validate_loc.py --file path.yml    # validate single file
  python validate_loc.py --verbose          # show all issues
"""

import re
import sys
from pathlib import Path
from collections import Counter

KEY_RE = re.compile(r'^([^:]+?):\d*\s+"(.*)"$')


def validate_file(filepath, verbose=False):
    """Validate a single .yml file. Returns list of issues."""
    issues = []
    
    with open(filepath, 'rb') as f:
        raw = f.read()
    
    # Check BOM
    if not raw.startswith(b'\xef\xbb\xbf'):
        issues.append('Missing UTF-8 BOM')
    
    # Parse content
    try:
        content = raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        issues.append('Invalid UTF-8 encoding')
        return issues
    
    lines = content.split('\n')
    
    # Check first non-empty line is language header
    for line in lines:
        stripped = line.strip()
        if stripped:
            if not stripped.startswith('l_russian:') and not stripped.startswith('l_english:'):
                issues.append(f'First non-empty line not language header: {stripped[:40]}')
            break
    
    # Parse keys
    keys = []
    key_counter = Counter()
    todo_count = 0
    empty_count = 0
    
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if not stripped or stripped.startswith('#') or stripped.startswith('l_'):
            continue
        
        m = KEY_RE.match(stripped)
        if m:
            key = m.group(1)
            value = m.group(2)
            keys.append((i, key, value))
            key_counter[key] += 1
            
            if 'TODO' in value:
                todo_count += 1
            if not value:
                empty_count += 1
        else:
            # Check for malformed lines
            if ':' in stripped and '"' in stripped:
                if verbose:
                    issues.append(f'Line {i}: Possible malformed key: {stripped[:50]}')
    
    # Report duplicates
    duplicates = {k: v for k, v in key_counter.items() if v > 1}
    if duplicates and verbose:
        for key, count in sorted(duplicates.items()):
            issues.append(f'Duplicate key: {key} (appears {count} times)')
    
    # Summary stats
    stats = {
        'total_keys': len(keys),
        'todo_keys': todo_count,
        'empty_values': empty_count,
        'duplicates': len(duplicates),
    }
    
    return issues, stats


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Validate HOI4 localization files')
    parser.add_argument('--file', help='Validate single file')
    parser.add_argument('--verbose', action='store_true', help='Show all issues')
    args = parser.parse_args()
    
    if args.file:
        files = [Path(args.file)]
    else:
        # Find all .yml files in localisation/
        files = list(Path('.').rglob('*_l_russian.yml'))
        if not files:
            files = list(Path('.').rglob('localisation/**/*.yml'))
    
    if not files:
        print('No .yml files found')
        sys.exit(1)
    
    total_stats = {'total_keys': 0, 'todo_keys': 0, 'empty_values': 0, 'duplicates': 0}
    all_issues = []
    
    for filepath in sorted(files):
        result = validate_file(filepath, verbose=args.verbose)
        if isinstance(result, tuple):
            issues, stats = result
        else:
            issues = result
            stats = {'total_keys': 0, 'todo_keys': 0, 'empty_values': 0, 'duplicates': 0}
        
        for k in total_stats:
            total_stats[k] += stats.get(k, 0)
        
        if issues:
            all_issues.append((str(filepath), issues))
    
    # Print report
    print('=' * 60)
    print('LOCALIZATION VALIDATION REPORT')
    print('=' * 60)
    print(f'Files:                {len(files)}')
    print(f'Total keys:           {total_stats["total_keys"]}')
    print(f'Translated:           {total_stats["total_keys"] - total_stats["todo_keys"]}')
    print(f'TODO remaining:       {total_stats["todo_keys"]}')
    print(f'Empty values:         {total_stats["empty_values"]}')
    print(f'Duplicate keys:       {total_stats["duplicates"]}')
    print('=' * 60)
    
    if all_issues:
        print(f'\nIssues found in {len(all_issues)} files:')
        for fname, issues in all_issues:
            print(f'\n  {fname}:')
            for iss in issues[:10]:
                print(f'    - {iss}')
    else:
        print('\nNo issues found!')
    
    # Return exit code
    sys.exit(1 if all_issues else 0)


if __name__ == '__main__':
    main()
