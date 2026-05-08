#!/usr/bin/env python3
"""Auto-generated script to update national focus icon references."""

import re
from pathlib import Path

UPDATES = [
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 10242, "old": "GFX_goal_generic_construct_infrastructure", "new": "GFX_focus_custom_BLHM_GER_develop_portuguese_mining"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 15628, "old": "GFX_goal_generic_construct_civ_factory", "new": "GFX_focus_custom_BLHM_GER_invest_in_italian_industry"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 15659, "old": "GFX_focus_generic_industry_3", "new": "GFX_focus_custom_BLHM_GER_libyan_industry"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 15746, "old": "GFX_focus_generic_combined_arms", "new": "GFX_focus_custom_BLHM_GER_mediterranean_exercises"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 15723, "old": "GFX_focus_generic_military_mission", "new": "GFX_focus_custom_BLHM_GER_prepare_east_african_sabotage"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 15687, "old": "GFX_goal_generic_navy_cruiser", "new": "GFX_focus_custom_BLHM_GER_spanish_african_bases"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 12749, "old": "GFX_focus_GER_wunderwaffe_inner_circle", "new": "GFX_focus_custom_BLHM_GER_wunderwaffe_program"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 15547, "old": "GFX_focus_generic_industry_2", "new": "GFX_focus_custom_GER_consolidate_management_of_minor_powers"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 15428, "old": "GFX_goal_generic_construct_civ_factory", "new": "GFX_focus_custom_GER_develop_hungarian_bauxite_deposits"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 15400, "old": "GFX_goal_generic_political_pressure", "new": "GFX_focus_custom_GER_diplomatic_pressure_on_potential_allies"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 11349, "old": "GFX_goal_generic_major_war", "new": "GFX_focus_custom_GER_east_front_continue_offensive"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 11448, "old": "GFX_goal_generic_fortify_city", "new": "GFX_focus_custom_GER_east_front_defensive_tactics"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 11496, "old": "GFX_goal_generic_secret_weapon", "new": "GFX_focus_custom_GER_east_front_destroy_partisans"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 11383, "old": "GFX_goal_generic_attack_allies", "new": "GFX_focus_custom_GER_east_front_final_blow"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 11242, "old": "GFX_goal_generic_construct_military", "new": "GFX_focus_custom_GER_east_front_fortify_lines"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 11422, "old": "GFX_goal_generic_war_with_comintern", "new": "GFX_focus_custom_GER_east_front_prepare_long_war"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 11315, "old": "GFX_goal_generic_construct_military", "new": "GFX_focus_custom_GER_east_front_prepare_second_winter"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 11276, "old": "GFX_goal_generic_attack_allies", "new": "GFX_focus_custom_GER_east_front_summer_campaign"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 11472, "old": "GFX_goal_generic_construct_infrastructure", "new": "GFX_focus_custom_GER_east_front_supply_routes"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 11520, "old": "GFX_goal_generic_dangerous_deal", "new": "GFX_focus_custom_GER_east_front_victory_or_death"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 11208, "old": "GFX_goal_generic_position_armies", "new": "GFX_focus_custom_GER_east_front_win_before_winter"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 15476, "old": "GFX_goal_generic_oil_refinery", "new": "GFX_focus_custom_GER_expand_oil_extraction_in_ploesti"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 9327, "old": "GFX_focus_PER_czech_tanks", "new": "GFX_focus_custom_GER_integrate_czech_manufacturers"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 15519, "old": "GFX_goal_generic_construct_mil_factory", "new": "GFX_focus_custom_GER_sofia_initiative"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 12993, "old": "GFX_focus_generic_army_tanks2", "new": "GFX_focus_custom_GER_wunderwaffe_e50"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 12993, "old": "GFX_focus_generic_army_tanks2", "new": "GFX_focus_custom_GER_wunderwaffe_e50_unification"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 12894, "old": "GFX_focus_generic_heavy_tank", "new": "GFX_focus_custom_GER_wunderwaffe_maus"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 12774, "old": "GFX_focus_generic_jet_planes", "new": "GFX_focus_custom_GER_wunderwaffe_me262"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/germany.txt", "line": 12848, "old": "GFX_focus_generic_army_tanks2", "new": "GFX_focus_custom_GER_wunderwaffe_rotte"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/soviet.txt", "line": 9180, "old": "GFX_focus_SOV_mobilization_plan", "new": "GFX_focus_custom_SOV_mobilization_first_wave"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/soviet.txt", "line": 9225, "old": "GFX_focus_generic_full_social_mobilization", "new": "GFX_focus_custom_SOV_mobilization_second_wave"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/soviet.txt", "line": 9282, "old": "GFX_goal_generic_major_war", "new": "GFX_focus_custom_SOV_operation_bagration"},
    {"nf_file": "/home/nickadminroot/.local/share/Paradox Interactive/Hearts of Iron IV/mod/BigLeninHistMod/BigLeninHistMod/common/national_focus/soviet.txt", "line": 9254, "old": "GFX_focus_SOV_penal_battalions", "new": "GFX_focus_custom_SOV_order_227"},
]

for u in UPDATES:
    p = Path(u['nf_file'])
    lines = p.read_text(encoding='utf-8').split('\n')
    i = u['line'] - 1
    if i < len(lines) and u['old'] in lines[i]:
        lines[i] = lines[i].replace(u['old'], u['new'])
        p.write_text('\n'.join(lines), encoding='utf-8')
        print(f'Updated: {p}:{u["line"]}  {u["old"]} -> {u["new"]}')
    else:
        print(f'SKIP (line changed): {p}:{u["line"]}')
