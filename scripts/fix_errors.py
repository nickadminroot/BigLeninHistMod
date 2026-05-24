"""Fix HOI4 mod errors from smoke test - remove invalid effect lines."""
import os

def remove_lines(filepath, lines_set):
    """Remove specific 1-indexed lines from a file with CRLF line endings."""
    with open(filepath, 'rb') as f:
        data = f.read()
    lines = data.split(b'\r\n')
    
    result = []
    for i, line in enumerate(lines, start=1):
        if i not in lines_set:
            result.append(line)
    
    new_data = b'\r\n'.join(result)
    if data.endswith(b'\r\n'):
        new_data += b'\r\n'
    
    with open(filepath, 'wb') as f:
        f.write(new_data)
    
    print(f'{filepath}: removed lines {sorted(lines_set)}')


# Mapping of files to their line numbers to remove
# The errors said:
# common/factions/goals/faction_goals_short_term.txt:224,571,632 (add_timed_idea for CHI)
# common/decisions/TOA_shared_decisions.txt:3653 (swap_ideas for VEN)
# common/decisions/_exiled_governments_decisions.txt:354 (add_timed_idea for ETH)
# common/on_actions/00_on_actions.txt:5643,5657,5673,5687 (CZE)
# common/on_actions/09_aat_on_actions.txt:1697 (add_timed_idea for SWE)
# history/countries/GRE - Greece.txt:188 (add_timed_idea for GRE)
# events/AAT_Finland.txt:5399 (add_timed_idea for ETH)
# events/China.txt:1307 (add_timed_idea for CHI)
# events/SEA_Nat_China.txt:2277,2918 (add_timed_idea for CHI)

ROOT = 'BigLeninHistMod'

# 1. faction_goals_short_term.txt - already done

# 2. TOA_shared_decisions.txt - VEN swap_ideas block (line 3653-3657)
# The block is:
# \t\t\t\tVEN = { 
# \t\t\t\t\tswap_ideas = {
# \t\t\t\t\t\tremove_idea = idea_VEN_blockade_inactive
# \t\t\t\t\t\tadd_idea = idea_VEN_blockade_active
# \t\t\t\t\t}
# \t\t\t\t}
# Lines 3653-3658 (6 lines)
fp = os.path.join(ROOT, 'common/decisions/TOA_shared_decisions.txt')
# Find the exact VEN block
with open(fp, 'rb') as f:
    data = f.read()
lines = data.split(b'\r\n')
ven_lines = set()
for i, line in enumerate(lines, start=1):
    if b'swap_ideas' in line and b'VEN' in line:
        # This is line 3653, remove lines 3653-3658
        for j in range(i, i+6):
            ven_lines.add(j)
        break
if ven_lines:
    remove_lines(fp, ven_lines)

# 3. _exiled_governments_decisions.txt - ETH purge_ideology_boost_idea
fp = os.path.join(ROOT, 'common/decisions/_exiled_governments_decisions.txt')
with open(fp, 'rb') as f:
    data = f.read()
lines = data.split(b'\r\n')
# Find ETH_purge_ideology_boost_idea and remove the add_timed_idea block (4 lines)
for i, line in enumerate(lines, start=1):
    if b'ETH_purge_ideology_boost_idea' in line:
        # The add_timed_idea block starts 1 line above
        add_timed_line = i - 1
        remove_lines(fp, {add_timed_line, add_timed_line+1, add_timed_line+2, add_timed_line+3})
        break

# 4. on_actions/00_on_actions.txt - CZE_skoda_weapon_sales_dummy_idea
fp = os.path.join(ROOT, 'common/on_actions/00_on_actions.txt')
with open(fp, 'rb') as f:
    data = f.read()
lines = data.split(b'\r\n')
# Find all add_timed_idea / modify_timed_idea blocks referencing CZE_skoda
# These are blocks of 4 lines each
cze_lines_to_remove = set()
for i, line in enumerate(lines, start=1):
    text = line.decode('utf-8', errors='replace').strip()
    if text == 'add_timed_idea = {' or text == 'modify_timed_idea = {':
        if i < len(lines) and b'CZE_skoda_weapon_sales_dummy_idea' in lines[i]:
            # Block starts at i, has 4 lines: add_timed_idea = {, idea = ..., months = ..., }
            for j in range(i, i+4):
                cze_lines_to_remove.add(j)
if cze_lines_to_remove:
    remove_lines(fp, cze_lines_to_remove)

# 5. on_actions/09_aat_on_actions.txt - SWE_crusade_against_the_eastern_threat
fp = os.path.join(ROOT, 'common/on_actions/09_aat_on_actions.txt')
with open(fp, 'rb') as f:
    data = f.read()
lines = data.split(b'\r\n')
for i, line in enumerate(lines, start=1):
    if b'SWE_crusade_against_the_eastern_threat' in line:
        # Find the add_timed_idea block (3 lines before this)
        # The error says line 1697: add_timed_idea for SWE
        if i > 1 and b'add_timed_idea' in lines[i-2]:
            remove_lines(fp, {i-2, i-1, i, i+1})
        elif i > 0 and b'add_timed_idea' in lines[i-1]:
            remove_lines(fp, {i-1, i, i+1, i+2})
        break

# 6. history/countries/GRE - Greece.txt - GRE_four_year_plan_spirit
fp = os.path.join(ROOT, 'history/countries/GRE - Greece.txt')
with open(fp, 'rb') as f:
    data = f.read()
lines = data.split(b'\r\n')
for i, line in enumerate(lines, start=1):
    if b'GRE_four_year_plan_spirit' in line:
        # Find the add_timed_idea block start
        for j in range(i-3, i):
            if b'add_timed_idea' in lines[j-1]:
                remove_lines(fp, {j, j+1, j+2, j+3})
                break
        break

# 7. events/AAT_Finland.txt - ETH_aid_SPC
fp = os.path.join(ROOT, 'events/AAT_Finland.txt')
with open(fp, 'rb') as f:
    data = f.read()
lines = data.split(b'\r\n')
for i, line in enumerate(lines, start=1):
    if b'ETH_aid_SPC' in line:
        for j in range(i-3, i):
            if b'add_timed_idea' in lines[j-1]:
                remove_lines(fp, {j, j+1, j+2, j+3})
                break
        break

# 8. events/China.txt - CHI_civil_war_deserters (one-liner)
fp = os.path.join(ROOT, 'events/China.txt')
with open(fp, 'rb') as f:
    data = f.read()
lines = data.split(b'\r\n')
for i, line in enumerate(lines, start=1):
    if b'CHI_civil_war_deserters' in line:
        remove_lines(fp, {i})
        break

# 9. events/SEA_Nat_China.txt - CHI_republican_agitation and idea_CHI_central_government_minquan_pressure_democratic
fp = os.path.join(ROOT, 'events/SEA_Nat_China.txt')
with open(fp, 'rb') as f:
    data = f.read()
lines = data.split(b'\r\n')
# Find CHI_republican_agitation (4-line block)
for i, line in enumerate(lines, start=1):
    if b'CHI_republican_agitation' in line:
        for j in range(i-3, i):
            if b'add_timed_idea' in lines[j-1]:
                remove_lines(fp, {j, j+1, j+2, j+3})
                break
        break

# Find idea_CHI_central_government_minquan_pressure_democratic (4-line block)
for i, line in enumerate(lines, start=1):
    if b'idea_CHI_central_government_minquan_pressure_democratic' in line:
        for j in range(i-3, i):
            if b'add_timed_idea' in lines[j-1]:
                remove_lines(fp, {j, j+1, j+2, j+3})
                break
        break

print("All fixes applied.")
