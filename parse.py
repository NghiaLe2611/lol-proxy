import json
import sys
import os

STAT_MAP = {
    1: "Armor",
    2: "AD",
    3: "AP",
    4: "AttackSpeed",
    5: "Health",
    6: "BonusArmor",
    7: "BonusAD",
    8: "BonusHealth",
    9: "BonusMagicResist",
    10: "MagicResist",
    11: "MoveSpeed",
    12: "MaxHealth",
}

def resolve_key(bin_data, key):
    if key in bin_data:
        return bin_data[key]
    return None

def parse_formula_parts(parts, data_values):
    parsed_parts = []
    for part in parts:
        ptype = part.get("__type", "")
        if ptype == "NamedDataValueCalculationPart":
            data_val = part.get("mDataValue", "")
            # Sometimes data value names are case-insensitive in Riot's logic
            # Let's try direct first, then case-insensitive
            vals = data_values.get(data_val)
            if not vals:
                lower_key = data_val.lower()
                for k, v in data_values.items():
                    if k.lower() == lower_key:
                        vals = v
                        data_val = k
                        break
            parsed_parts.append({
                "type": "base_damage",
                "data_value": data_val,
                "values": vals or []
            })
        elif ptype == "StatByNamedDataValueCalculationPart":
            data_val = part.get("mDataValue", "")
            stat_id = part.get("mStat", 3) 
            vals = data_values.get(data_val)
            if not vals:
                lower_key = data_val.lower()
                for k, v in data_values.items():
                    if k.lower() == lower_key:
                        vals = v
                        data_val = k
                        break
            parsed_parts.append({
                "type": "ratio_damage_dynamic",
                "stat": STAT_MAP.get(stat_id, f"Stat_{stat_id}"),
                "data_value": data_val,
                "values": vals or []
            })
        elif ptype == "StatByCoefficientCalculationPart":
            stat_id = part.get("mStat", 3)
            coef = part.get("mCoefficient", 0)
            parsed_parts.append({
                "type": "ratio_damage_fixed",
                "stat": STAT_MAP.get(stat_id, f"Stat_{stat_id}"),
                "coefficient": coef
            })
        elif ptype == "NumberCalculationPart":
            parsed_parts.append({
                "type": "constant",
                "value": part.get("mNumber", 0)
            })
        elif ptype in ["ByCharLevelBreakpointsCalculationPart", "ByCharLevelInterpolationCalculationPart"]:
            parsed_parts.append({
                "type": "level_scaling",
                "raw": part
            })
        else:
            parsed_parts.append({
                "type": "unknown",
                "raw": part
            })
    return parsed_parts

def extract_spell_info(bin_data, spell_key):
    spell_obj = resolve_key(bin_data, spell_key)
    if not spell_obj:
        return None

    mSpell = spell_obj.get("mSpell", {})
    if not mSpell and "mSpell" in spell_obj:
        mSpell = resolve_key(bin_data, spell_obj["mSpell"])
    if not mSpell:
        mSpell = spell_obj
    
    info = {
        "key": spell_key,
        "name": spell_obj.get("ObjectName", spell_key.split("/")[-1]),
        "data_values": {},
        "calculations": {},
        "cooldown": mSpell.get("cooldownTime", []),
        "mana": mSpell.get("mana", []),
        "cast_range": mSpell.get("castRange", []),
        "effect_amounts": [],
        "children": []
    }

    # 1. Parse DataValues
    for dv in mSpell.get("DataValues", []):
        name = dv.get("name")
        values = dv.get("values", [])
        if name:
            info["data_values"][name] = values

    # 2. Parse Calculations
    calcs = mSpell.get("mSpellCalculations", {})
    for calc_name, calc_data in calcs.items():
        if "mFormulaParts" in calc_data:
            info["calculations"][calc_name] = parse_formula_parts(
                calc_data["mFormulaParts"], 
                info["data_values"]
            )
        elif "mModifiedGameCalculation" in calc_data:
            mult_data = calc_data.get("mMultiplier", {})
            mult_val = mult_data.get("mDataValue")
            if not mult_val and "mSubparts" in mult_data:
                for sub in mult_data["mSubparts"]:
                    if "mDataValue" in sub:
                        mult_val = sub["mDataValue"]
                        break
            info["calculations"][calc_name] = {
                "type": "modified",
                "base": calc_data.get("mModifiedGameCalculation"),
                "multiplier_data_value": mult_val
            }

    # 3. Parse mEffectAmount
    for effect in mSpell.get("mEffectAmount", []):
        if "value" in effect:
            info["effect_amounts"].append(effect["value"])

    coef = mSpell.get("mCoefficient")
    if coef is not None:
        info["fixed_coefficient"] = coef
    
    return info

def parse_bin_file(filepath):
    """
    Hàm 1: Parse file bin.json ra dictionary chứa data skill Q, W, E, R
    """
    with open(filepath, "r", encoding="utf-8") as f:
        bin_data = json.load(f)

    root_record = None
    character_name = ""
    for key, val in bin_data.items():
        if key.endswith("CharacterRecords/Root"):
            root_record = val
            character_name = val.get("mCharacterName", "")
            break

    if not root_record:
        raise Exception("Could not find CharacterRecords/Root in bin data.")

    # Get the 4 main spells via spellNames
    spell_names = root_record.get("spellNames", [])
    skills_data = {}

    for slot_idx, spell_path in enumerate(spell_names):
        if slot_idx > 3:
            break
        
        slot_name = ["Q", "W", "E", "R"][slot_idx]

        if not spell_path.startswith("Characters/"):
            spell_key = f"Characters/{character_name}/Spells/{spell_path}"
        else:
            spell_key = spell_path

        ability_key = spell_key.rsplit("/", 1)[0]
        ability_obj = resolve_key(bin_data, ability_key)

        if not ability_obj:
            root_spell_key = spell_key
            child_keys = []
        else:
            root_spell_key = ability_obj.get("mRootSpell", spell_key)
            child_keys = ability_obj.get("mChildSpells", [])

        skill_info = extract_spell_info(bin_data, root_spell_key)
        
        if skill_info:
            skill_info["slot"] = slot_name
            
            # extract children
            for child_key in child_keys:
                if child_key != root_spell_key:
                    child_info = extract_spell_info(bin_data, child_key)
                    if child_info:
                        skill_info["children"].append(child_info)
                        
            skills_data[slot_name] = skill_info

    return {
        "champion": character_name,
        "skills": skills_data
    }

def get_skill_detail(skills_data, slot):
    """
    Hàm 2: Trả ra detail skill từ slot Q, W, E, R
    """
    slot = slot.upper()
    return skills_data.get("skills", {}).get(slot)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 parse.py <path_to_bin_file.json>")
        sys.exit(1)

    filepath = sys.argv[1]
    
    try:
        skills_data = parse_bin_file(filepath)
        # In ra toàn bộ data đã parse dưới dạng JSON
        # print(json.dumps(skills_data, indent=2))

        # Lưu thành file result.json
        with open('result.json', 'w', encoding='utf-8') as f:
            result = json.dump(skills_data, f, indent=2, ensure_ascii=False)
            print(result)
        print("✅ Đã lưu thành công file result.json")

        # Đọc file result và truyền skill 
    except Exception as e:
        print(f"Error parsing {filepath}: {e}", file=sys.stderr)
        sys.exit(1)
