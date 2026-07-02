import type { ChampionSkill, DdragonSpell, SkillDataField, SkillFormulaPart } from './types';

type BinJson = Record<string, unknown>;
type BinSpellObject = {
	mScriptName?: string;
	ObjectName?: string;
	mSpell?: BinSpellResource;
};

type BinSpellResource = Record<string, unknown> & {
	DataValues?: BinDataValue[];
	mSpellCalculations?: Record<string, BinCalculation>;
	cooldownTime?: number[];
	mana?: number[];
	castRange?: number[];
	castRangeDisplayOverride?: number[];
	castRadius?: number[];
	mCastTime?: number;
	mLineWidth?: number;
	missileSpeed?: number;
};

type BinDataValue = {
	name: string;
	values: number[];
};

type BinCalculation = Record<string, unknown> & {
	mFormulaParts?: unknown[];
	mMultiplier?: unknown;
	mModifiedGameCalculation?: string;
	mDisplayAsPercent?: boolean;
	__type?: string;
};

const STAT_BY_ID: Record<number, string> = {
	1: 'Health',
	2: 'AD',
	3: 'AP',
	4: 'Armor',
	5: 'MR',
	6: 'AttackSpeed',
	7: 'MovementSpeed',
	12: 'MaxHealth',
};

const SKIP_PLACEHOLDERS = new Set(['spellmodifierdescriptionappend']);

function capitalizeChampionId(id: string): string {
	const lower = id.toLowerCase();
	return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function toDataKey(name: string): string {
	return name.toLowerCase();
}

function roundValue(value: number): number {
	if (Number.isInteger(value)) return value;
	return Math.round(value * 1000) / 1000;
}

function sliceRankValues(values: number[], maxRank: number): number[] {
	return values.slice(1, maxRank + 1).map(roundValue);
}

function indexBinSpells(bin: BinJson): Map<string, BinSpellObject> {
	const map = new Map<string, BinSpellObject>();
	for (const entry of Object.values(bin)) {
		if (!entry || typeof entry !== 'object') continue;
		const obj = entry as BinSpellObject;
		if ((entry as Record<string, unknown>).__type !== 'SpellObject') continue;
		if (typeof obj.mScriptName === 'string') map.set(obj.mScriptName, obj);
	}
	return map;
}

function getDataValueMap(spell: BinSpellResource | undefined): Map<string, BinDataValue> {
	const map = new Map<string, BinDataValue>();
	if (!spell?.DataValues) return map;
	for (const dv of spell.DataValues) {
		if (dv?.name) map.set(toDataKey(dv.name), dv);
	}
	return map;
}

function getCalculationMaps(spell: BinSpellResource | undefined) {
	const byKey = new Map<string, BinCalculation>();
	const byLower = new Map<string, string>();
	if (!spell?.mSpellCalculations) return { byKey, byLower };
	for (const [key, calc] of Object.entries(spell.mSpellCalculations)) {
		byKey.set(key, calc);
		byLower.set(toDataKey(key), key);
	}
	return { byKey, byLower };
}

function parsePlaceholderExpr(expr: string): { key: string; displayMultiplier?: number } {
	const trimmed = expr.trim();
	if (SKIP_PLACEHOLDERS.has(trimmed.toLowerCase())) {
		return { key: '' };
	}
	const mulMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s*\*\s*(-?\d+(?:\.\d+)?)/);
	if (mulMatch) {
		return { key: mulMatch[1].toLowerCase(), displayMultiplier: roundValue(parseFloat(mulMatch[2])) };
	}
	return { key: trimmed.replace(/\s+/g, '').toLowerCase() };
}

function extractPlaceholders(tooltip: string): { key: string; displayMultiplier?: number }[] {
	const seen = new Set<string>();
	const result: { key: string; displayMultiplier?: number }[] = [];
	const regex = /\{\{\s*([^}]+)\s*\}\}/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(tooltip)) !== null) {
		const parsed = parsePlaceholderExpr(match[1]);
		if (!parsed.key || seen.has(parsed.key)) continue;
		seen.add(parsed.key);
		result.push(parsed);
	}
	return result;
}

function getPlaceholderTypes(tooltip: string): Map<string, string> {
	const types = new Map<string, string>();
	const tagRegex = /<(\w+)>([\s\S]*?)<\/\1>/gi;
	let tagMatch: RegExpExecArray | null;
	while ((tagMatch = tagRegex.exec(tooltip)) !== null) {
		const tag = tagMatch[1];
		const inner = tagMatch[2];
		const phRegex = /\{\{\s*([^}]+)\s*\}\}/g;
		let phMatch: RegExpExecArray | null;
		while ((phMatch = phRegex.exec(inner)) !== null) {
			const { key } = parsePlaceholderExpr(phMatch[1]);
			if (key) types.set(key, tag);
		}
	}
	return types;
}

function buildFormulaParts(
	parts: unknown[] | undefined,
	dataValues: Map<string, BinDataValue>,
	maxRank: number,
): SkillFormulaPart[] {
	if (!parts?.length) return [];
	const result: SkillFormulaPart[] = [];

	for (const part of parts) {
		if (!part || typeof part !== 'object') continue;
		const p = part as Record<string, unknown>;
		const type = p.__type as string | undefined;

		if (type === 'NamedDataValueCalculationPart' && typeof p.mDataValue === 'string') {
			const key = toDataKey(p.mDataValue);
			const dv = dataValues.get(key);
			result.push({
				kind: 'base',
				dataValue: key,
				values: dv ? sliceRankValues(dv.values, maxRank) : undefined,
			});
			continue;
		}

		if (type === 'StatByNamedDataValueCalculationPart' && typeof p.mDataValue === 'string') {
			const key = toDataKey(p.mDataValue);
			const dv = dataValues.get(key);
			const stat = typeof p.mStat === 'number' ? STAT_BY_ID[p.mStat] ?? `Stat${p.mStat}` : undefined;
			result.push({
				kind: 'ratio',
				dataValue: key,
				stat,
				values: dv ? sliceRankValues(dv.values, maxRank) : undefined,
			});
			continue;
		}

		if (type === 'StatByCoefficientCalculationPart') {
			result.push({
				kind: 'coefficient',
				stat: 'AP',
				coefficient: typeof p.mCoefficient === 'number' ? roundValue(p.mCoefficient) : undefined,
			});
			continue;
		}

		if (type === 'ByCharLevelInterpolationCalculationPart') {
			result.push({
				kind: 'interpolation',
				values: [
					typeof p.mStartValue === 'number' ? roundValue(p.mStartValue) : 0,
					typeof p.mEndValue === 'number' ? roundValue(p.mEndValue) : 0,
				],
			});
		}
	}

	return result;
}

function resolveMultiplier(
	multiplier: unknown,
	dataValues: Map<string, BinDataValue>,
	maxRank: number,
): SkillDataField['multiplier'] {
	if (!multiplier || typeof multiplier !== 'object') return undefined;
	const m = multiplier as Record<string, unknown>;

	if (typeof m.mDataValue === 'string') {
		const key = toDataKey(m.mDataValue);
		const dv = dataValues.get(key);
		return {
			dataValue: key,
			values: dv ? sliceRankValues(dv.values, maxRank) : undefined,
		};
	}

	if (typeof m.mNumber === 'number') {
		return { constant: roundValue(m.mNumber) };
	}

	if (Array.isArray(m.mSubparts)) {
		for (const sub of m.mSubparts) {
			if (!sub || typeof sub !== 'object') continue;
			const s = sub as Record<string, unknown>;
			if (typeof s.mDataValue === 'string') {
				const key = toDataKey(s.mDataValue);
				const dv = dataValues.get(key);
				return {
					dataValue: key,
					values: dv ? sliceRankValues(dv.values, maxRank) : undefined,
				};
			}
		}
	}

	return undefined;
}

function getMultiplierMode(multiplier: unknown): 'scale' | 'bonus' {
	if (!multiplier || typeof multiplier !== 'object') return 'scale';
	const m = multiplier as Record<string, unknown>;
	if (m.__type === 'SumOfSubPartsCalculationPart' && Array.isArray(m.mSubparts)) {
		const hasOne = m.mSubparts.some(
			(sub) => sub && typeof sub === 'object' && (sub as Record<string, unknown>).mNumber === 1.0,
		);
		if (hasOne) return 'bonus';
	}
	return 'scale';
}

function buildCalculationField(
	calcKey: string,
	calc: BinCalculation,
	dataValues: Map<string, BinDataValue>,
	maxRank: number,
	type?: string,
	displayMultiplier?: number,
): SkillDataField {
	const isModified = calc.__type === 'GameCalculationModified' || calc.mModifiedGameCalculation;

	if (isModified) {
		const baseKey =
			typeof calc.mModifiedGameCalculation === 'string'
				? toDataKey(calc.mModifiedGameCalculation)
				: undefined;
		return {
			type,
			calculation: 'mMultiplier',
			baseCalculation: baseKey,
			multiplier: resolveMultiplier(calc.mMultiplier, dataValues, maxRank),
			multiplierMode: getMultiplierMode(calc.mMultiplier),
			displayMultiplier,
			displayAsPercent: calc.mDisplayAsPercent === true,
		};
	}

	const scalarMultiplier =
		calc.mMultiplier && typeof calc.mMultiplier === 'object'
			? (calc.mMultiplier as Record<string, unknown>).mNumber
			: undefined;

	return {
		type,
		calculation: 'mFormulaParts',
		parts: buildFormulaParts(calc.mFormulaParts, dataValues, maxRank),
		displayMultiplier,
		displayAsPercent: calc.mDisplayAsPercent === true,
		scalarMultiplier: typeof scalarMultiplier === 'number' ? roundValue(scalarMultiplier) : undefined,
	};
}

function buildDataValueField(
	dv: BinDataValue,
	maxRank: number,
	type?: string,
	displayMultiplier?: number,
	displayAsPercent?: boolean,
): SkillDataField {
	return {
		type,
		values: sliceRankValues(dv.values, maxRank),
		displayMultiplier,
		displayAsPercent,
	};
}

function addBinScalars(
	data: ChampionSkill['data'],
	spell: BinSpellResource | undefined,
	ddragonSpell: DdragonSpell,
	maxRank: number,
) {
	if (spell?.cooldownTime?.length) {
		data.cooldown = sliceRankValues(spell.cooldownTime, maxRank);
	} else if (ddragonSpell.cooldown?.length) {
		data.cooldown = ddragonSpell.cooldown.map(roundValue);
	}

	if (spell?.mana?.length) {
		data.cost = sliceRankValues(spell.mana, maxRank);
	} else if (ddragonSpell.cost?.length) {
		data.cost = ddragonSpell.cost.map(roundValue);
	}

	const rangeSource = spell?.castRangeDisplayOverride ?? spell?.castRange;
	if (rangeSource?.length) {
		data.range = sliceRankValues(rangeSource, maxRank);
	} else if (ddragonSpell.range?.length) {
		data.range = ddragonSpell.range.map(roundValue);
	}

	if (typeof spell?.mCastTime === 'number') data.castTime = roundValue(spell.mCastTime);
	if (typeof spell?.mLineWidth === 'number') data.width = roundValue(spell.mLineWidth);
	if (typeof spell?.missileSpeed === 'number') data.speed = roundValue(spell.missileSpeed);
	if (spell?.castRadius?.length) data.effectRadius = sliceRankValues(spell.castRadius, maxRank);
}

function buildSkillFromSources(
	ddragonSpell: DdragonSpell,
	binSpell: BinSpellObject | undefined,
): ChampionSkill {
	const spellResource = binSpell?.mSpell;
	const maxRank = ddragonSpell.maxrank;
	const dataValues = getDataValueMap(spellResource);
	const { byKey, byLower } = getCalculationMaps(spellResource);
	const placeholderTypes = getPlaceholderTypes(ddragonSpell.tooltip);
	const data: ChampionSkill['data'] = {};
	const usedKeys = new Set<string>(['cooldown', 'cost', 'range', 'castTime', 'width', 'speed', 'effectRadius']);

	addBinScalars(data, spellResource, ddragonSpell, maxRank);

	for (const placeholder of extractPlaceholders(ddragonSpell.tooltip)) {
		const { key, displayMultiplier } = placeholder;
		if (!key || usedKeys.has(key)) continue;

		const type = placeholderTypes.get(key);
		const calcKey = byLower.get(key);
		if (calcKey) {
			const calc = byKey.get(calcKey);
			if (calc) {
				data[key] = buildCalculationField(calcKey, calc, dataValues, maxRank, type, displayMultiplier);
				usedKeys.add(key);
				if (data[key]?.calculation === 'mFormulaParts') {
					for (const part of (data[key] as SkillDataField).parts ?? []) {
						if (part.dataValue) usedKeys.add(part.dataValue);
					}
				}
				if ((data[key] as SkillDataField).multiplier?.dataValue) {
					usedKeys.add((data[key] as SkillDataField).multiplier!.dataValue!);
				}
				continue;
			}
		}

		const dv = dataValues.get(key);
		if (dv) {
			data[key] = buildDataValueField(dv, maxRank, type, displayMultiplier);
			usedKeys.add(key);
		}
	}

	for (const [key, dv] of dataValues) {
		if (usedKeys.has(key)) continue;
		data[key] = buildDataValueField(dv, maxRank);
	}

	return {
		id: ddragonSpell.id,
		name: ddragonSpell.name,
		description: ddragonSpell.description,
		rawDescription: ddragonSpell.tooltip,
		maxRank,
		data,
	};
}

export async function fetchChampionSkills(
	championId: string,
	version: string,
	lang: string,
): Promise<ChampionSkill[]> {
	const slug = championId.toLowerCase();
	const ddragonName = capitalizeChampionId(slug);

	const [binRes, ddragonRes] = await Promise.all([
		fetch(`https://raw.communitydragon.org/latest/game/data/characters/${slug}/${slug}.bin.json`),
		fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/${lang}/champion/${ddragonName}.json`),
	]);

	if (!binRes.ok) {
		const err = new Error(`CommunityDragon request failed: ${binRes.status} ${binRes.statusText}`) as Error & {
			statusCode: number;
		};
		err.statusCode = binRes.status;
		throw err;
	}
	if (!ddragonRes.ok) {
		const err = new Error(`Data Dragon request failed: ${ddragonRes.status} ${ddragonRes.statusText}`) as Error & {
			statusCode: number;
		};
		err.statusCode = ddragonRes.status;
		throw err;
	}

	const bin = (await binRes.json()) as BinJson;
	const ddragon = (await ddragonRes.json()) as {
		data?: Record<string, { spells?: DdragonSpell[] }>;
	};

	const championData = ddragon.data ?? {};
	const championKey =
		Object.keys(championData).find((k) => k.toLowerCase() === slug) ??
		(championData[ddragonName] ? ddragonName : undefined);
	const champion = championKey ? championData[championKey] : undefined;
	if (!champion?.spells?.length) {
		throw new Error(`No spells found for champion "${championId}"`);
	}

	const binSpells = indexBinSpells(bin);

	return champion.spells.map((spell) => buildSkillFromSources(spell, binSpells.get(spell.id)));
}
