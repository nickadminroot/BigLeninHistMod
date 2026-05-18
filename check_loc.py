import re, os

base = r'G:\Documents\Paradox Interactive\Hearts of Iron IV\mod\BigLeninHistMod.worktrees\Italy\BigLeninHistMod'

with open(os.path.join(base, 'common/national_focus/italy.txt'), 'r', encoding='utf-8') as f:
    content = f.read()

keys = set(re.findall(r'custom_effect_tooltip\s*=\s*(\S+)', content))

en_path = os.path.join(base, 'localisation/english/custom_l_english.yml')
ru_path = os.path.join(base, 'localisation/russian/custom_l_russian.yml')

with open(en_path, 'r', encoding='utf-8') as f:
    en_text = f.read()
with open(ru_path, 'r', encoding='utf-8') as f:
    ru_text = f.read()

for key in sorted(keys):
    en = key in en_text
    ru = key in ru_text
    status = ('EN_OK' if en else 'EN_MISS') + ' ' + ('RU_OK' if ru else 'RU_MISS')
    print(f'{status}: {key}')
