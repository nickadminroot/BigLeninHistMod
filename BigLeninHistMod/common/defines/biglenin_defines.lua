NDefines.NMilitary.EXPERIENCE_COMBAT_FACTOR = 0.1
NDefines.NMilitary.UNIT_LEADER_USE_NONLINEAR_XP_GAIN = false
NDefines.NMilitary.COMMANDER_LEVEL_UP_STAT_COUNT = 5
NDefines.NMilitary.PROMOTE_LEADER_CP_COST = 0.1
NDefines.NCountry.REINFORCEMENT_MANPOWER_DELIVERY_SPEED = 500.0	-- vanilla 10 Modifier for army manpower reinforcement delivery speed (travel time)
NDefines.NCountry.REINFORCEMENT_MANPOWER_CHUNK = 1            -- vanilla 0.1
NDefines.NCountry.EQUIPMENT_UPGRADE_CHUNK_MAX_SIZE = 100			-- vanilla 10  Maximum chunk size of equipment upgrade distribution per update.
NDefines.NMilitary.REINFORCEMENT_REQUEST_MAX_WAITING_DAYS = 2   -- Every X days the equipment will be sent, regardless if still didn't produced all that has been requested.
NDefines.NMilitary.REINFORCEMENT_REQUEST_DAYS_FREQUENCY = 2
NDefines.NMilitary.MIN_DIVISION_BRIGADE_HEIGHT = 5
NDefines.NMilitary.MAX_ARMY_EXPERIENCE = 9999;
NDefines.NMilitary.MAX_NAVY_EXPERIENCE = 9999;
NDefines.NMilitary.MAX_AIR_EXPERIENCE  = 9999;
NDefines.NMilitary.PROMOTE_LEADER_CP_COST = 0
NDefines.NMilitary.TRAINING_ATTRITION = 0
NDefines.NMilitary.DEPLOY_TRAINING_MAX_LEVEL = 2
NDefines.NMilitary.UNIT_LEADER_ASSIGN_TRAIT_COST = 0
NDefines.NMilitary.BATALION_CHANGED_EXPERIENCE_DROP = 0.0
NDefines.NMilitary.CORPS_COMMANDER_DIVISIONS_CAP = 24
NDefines.NMilitary.FIELD_MARSHAL_DIVISIONS_CAP = 24
NDefines.NFocus.MAX_SAVED_FOCUS_PROGRESS = 30
NDefines.NSupply.SUPPLY_HUB_FULL_MOTORIZATION_BONUS = 3
NDefines.NMilitary.FUEL_CAPACITY_DEFAULT_HOURS = 192
NDefines.NAir.AIR_WING_FLIGHT_SPEED_MULT = 0.2
NDefines.NAir.AIR_DEPLOYMENT_DAYS = 0
NDefines.NCountry.BASE_RESEARCH_SLOTS = 3
NDefines.NCountry.BASE_MOBILIZATION_SPEED = 0.1
NDefines.NAI.MAX_VOLUNTEER_ARMY_FRACTION  = 0
NDefines.NAI.DIPLOMACY_ACCEPT_ATTACHE_OPINION_TRASHHOLD = 0
NDefines.NAI.DIPLOMACY_ACCEPT_ATTACHE_BASE = 200
NDefines.NAI.DIPLOMACY_ACCEPT_ATTACHE_OPINION_PENALTY = 0 -- Value of acceptance penalty if the opinion too low
NDefines.NCountry.CONVOY_LENDLEASE_RANGE_FACTOR = 0.1
NDefines.NCountry.CONVOY_RANGE_FACTOR = 0.5
NDefines.NCountry.CONVOY_INTERNATIONAL_MARKET_RANGE_FACTOR = 0.5
NDefines.NCountry.SPECIAL_FORCES_CAP_MIN = 250
NDefines.NAir.CAPACITY_PENALTY=0.869
NDefines.NAir.SUPPLY_NEED_FACTOR = 0.01
NDefines.NOperatives.OPERATIVE_BASE_BOOST_IDEOLOGY = 0
NDefines.NOperatives.MAX_PROPAGANDA_STABILITY_IMPACT = 0			-- Max total penalty from operative performing the propaganda mission in a country
NDefines.NOperatives.MAX_PROPAGANDA_WAR_SUPPORT_IMPACT = 0	

NDefines.NNavy.SUPPLY_NEED_FACTOR = 0.1

NDefines.NDoctrines.DEFAULT_REWARD_MASTERY = 50
NDefines.NDoctrines.NAVAL_MISSION_MASTERY_GAIN_FACTORS = {  -- Mastery gain from naval missions is reduced, just like training
		0.0, -- HOLD
		1, -- PATROL
		0.0, -- STRIKE FORCE
		1, -- CONVOY RAIDING
		1, -- CONVOY ESCORT
		1, -- MINES PLANTING
		1, -- MINES SWEEPING
		0.0, -- TRAIN # NOT USED - handled by TRAINING_MASTERY_GAIN_FACTOR
		0.0, -- RESERVE_FLEET
		0.0, -- NAVAL_INVASION_SUPPORT
	}
NDefines.NDoctrines.TRAINING_MASTERY_GAIN_FACTOR = 0.5

NDefines.NMilitary.BASE_DIVISION_BRIGADE_GROUP_COST = 0 	--Base cost to unlock a regiment slot,
NDefines.NMilitary.BASE_DIVISION_BRIGADE_CHANGE_COST = 0	--Base cost to change a regiment column.
NDefines.NMilitary.BASE_DIVISION_SUPPORT_SLOT_COST = 0 	--Base cost to unlock a support slot

NDefines.NMilitary.LAND_EQUIPMENT_BASE_COST = 0	-- Cost in XP to upgrade a piece of equipment one level is base + ( total levels * ramp )
NDefines.NMilitary.LAND_EQUIPMENT_RAMP_COST = 0
NDefines.NMilitary.NAVAL_EQUIPMENT_BASE_COST = 0
NDefines.NMilitary.NAVAL_EQUIPMENT_RAMP_COST = 0
NDefines.NMilitary.AIR_EQUIPMENT_BASE_COST = 0
NDefines.NMilitary.AIR_EQUIPMENT_RAMP_COST = 0

NDefines.NProduction.EQUIPMENT_MODULE_ADD_XP_COST = 0.0				-- XP cost for adding a new equipment module in an empty slot when creating an equipment variant.
NDefines.NProduction.EQUIPMENT_MODULE_REPLACE_XP_COST = 0.0				-- XP cost for replacing one equipment module with an unrelated module when creating an equipment variant.
NDefines.NProduction.EQUIPMENT_MODULE_CONVERT_XP_COST = 0.0				-- XP cost for converting one equipment module to a related module when creating an equipment variant.
NDefines.NProduction.EQUIPMENT_MODULE_REMOVE_XP_COST = 0.0

NDefines.NNavy.DEPTH_CHARGES_HIT_PROFILE = 70.0

NDefines.NNavy.CONVOY_EFFICIENCY_LOSS_MODIFIER = 0.4
NDefines.NProduction.BASE_LICENSE_IC_COST = 0;
NDefines.NProduction.LICENSE_IC_COST_YEAR_INCREASE = 0;
NDefines.NProduction.MIN_LICENSE_ACTIVE_DAYS = 1
NDefines.NProduction.LICENSE_EQUIPMENT_UPGRADE_XP_FACTOR = 1
--NDefines.NProduction.BASE_FACTORY_SPEED_MIL = 4 -- дефляция прома на 11%
NDefines.NProduction.CAPITAL_SHIP_MAX_NAV_FACTORIES_PER_LINE = 10