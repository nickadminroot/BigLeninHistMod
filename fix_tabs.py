import sys
fname = sys.argv[1]
with open(fname, 'rb') as f:
    data = f.read()
# Replace literal backslash-t (0x5C 0x74) with actual tab (0x09)
import re
fixed = re.sub(b'\\\\t', b'\t', data)
count = len(re.findall(b'\\\\t', data))
if fixed != data:
    with open(fname, 'wb') as f:
        f.write(fixed)
    print(f'Fixed {fname}: {count} occurrences replaced')
else:
    print(f'No changes to {fname}')
