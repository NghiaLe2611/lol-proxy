import { DEFAULT_BONUS_HEALTH_DISPLAY_UNIT } from './formulaProfiles';
import type {
	ChampionSkill,
	ParsedSkillDescription,
	SkillDataField,
	SkillDescriptionContext,
	SkillDescriptionSegment,
	SkillSegmentRole,
	SkillValueBreakdown,
} from './types';

type ComputedField = {
	total: number;
	formula: string;
	breakdown?: SkillValueBreakdown;
};

const SKIP_PLACEHOLDERS = new Set(['spellmodifierdescriptionappend']);

function roundDisplay(value: number): number {
	return Math.round(value * 10) / 10;
}

function clampLevel(level: number, maxRank: number): number {
	return Math.min(Math.max(level, 1), maxRank);
}

function levelIndex(level: number): number {
	return level - 1;
}

function tagToRole(tag: string): SkillSegmentRole {
	switch (tag) {
		case 'physicalDamage':
		case 'magicDamage':
		case 'trueDamage':
			return 'damage';
		case 'speed':
			return 'speed';
		case 'status':
			return 'status';
		case 'lifeSteal':
		case 'healing':
			return 'healing';
		case 'scaleAD':
		case 'scaleAP':
			return 'scale';
		case 'recast':
			return 'recast';
		case 'spellPassive':
			return 'passive';
		case 'spellActive':
			return 'active';
		default:
			return 'literal';
	}
}

function statValue(stat: string | undefined, ctx: SkillDescriptionContext): number {
	switch (stat) {
		case 'AD':
			return ctx.ad;
		case 'AP':
			return ctx.ap;
		default:
			return 0;
	}
}

function formatPercent(ratio: number): string {
	const pct = Math.round(ratio * 1000) / 10;
	return `${pct}%`;
}

function formatDamageFormula(breakdown: SkillValueBreakdown): string {
	const chunks: string[] = [];
	if (breakdown.baseDamage !== undefined && breakdown.baseDamage !== 0) {
		chunks.push(String(Math.round(breakdown.baseDamage)));
	}
	for (const r of breakdown.ratios ?? []) {
		if (r.ratio === 0) continue;
		chunks.push(`${formatPercent(r.ratio)} ${r.stat}`);
	}
	return chunks.length > 0 ? chunks.join(' + ') : '0';
}

function formatLifeStealFormula(breakdown: SkillValueBreakdown): string {
	const flat = breakdown.flatPercent ?? 0;
	const rate = breakdown.perBonusHealthRate ?? 0;
	const unit = breakdown.perBonusHealthUnit ?? DEFAULT_BONUS_HEALTH_DISPLAY_UNIT;
	const bonusHealth = breakdown.bonusHealth ?? 0;
	const bonusPercent = breakdown.bonusPercent ?? rate * bonusHealth;
	const total = flat + bonusPercent;

	if (bonusHealth > 0) {
		return `${formatPercent(total)} (+${formatPercent(bonusPercent)} per ${bonusHealth} bonus health)`;
	}

	return `${formatPercent(flat)} (+${formatPercent(rate * unit)} per ${unit} bonus health)`;
}

function interpolateValue(part: { values?: number[] }, championLevel: number): number {
	const [start = 0, end = 0] = part.values ?? [];
	const t = Math.min(Math.max((championLevel - 1) / 17, 0), 1);
	return start + (end - start) * t;
}

function computeDamageFormula(
	field: SkillDataField,
	ctx: SkillDescriptionContext,
	idx: number,
): ComputedField {
	const breakdown: SkillValueBreakdown = { ratios: [] };
	let total = 0;
	const championLevel = ctx.championLevel ?? 18;

	for (const part of field.parts ?? []) {
		if (part.kind === 'base_damage') {
			const base = part.values?.[idx] ?? 0;
			breakdown.baseDamage = (breakdown.baseDamage ?? 0) + base;
			total += base;
			continue;
		}

		if (part.kind === 'ratio_damage' || part.kind === 'coefficient') {
			const ratio = part.values?.[idx] ?? part.coefficient ?? 0;
			const stat = part.stat ?? 'AP';
			const amount = statValue(stat, ctx) * ratio;
			breakdown.ratios!.push({ stat, ratio, amount });
			total += amount;
			continue;
		}

		if (part.kind === 'interpolation') {
			const value = interpolateValue(part, championLevel);
			breakdown.baseDamage = (breakdown.baseDamage ?? 0) + value;
			total += value;
		}
	}

	if (field.scalarMultiplier !== undefined) {
		total *= field.scalarMultiplier;
		if (breakdown.baseDamage !== undefined) breakdown.baseDamage *= field.scalarMultiplier;
		for (const r of breakdown.ratios ?? []) {
			r.amount *= field.scalarMultiplier;
			r.ratio *= field.scalarMultiplier;
		}
	}

	return {
		total: Math.round(total),
		formula: formatDamageFormula(breakdown),
		breakdown,
	};
}

function computeLifeStealFormula(
	field: SkillDataField,
	ctx: SkillDescriptionContext,
	idx: number,
): ComputedField {
	let flat = 0;
	let rate = 0;
	let displayUnit = DEFAULT_BONUS_HEALTH_DISPLAY_UNIT;

	for (const part of field.parts ?? []) {
		if (part.kind === 'flat_percent') {
			flat = part.values?.[idx] ?? 0;
		}
		if (part.kind === 'per_bonus_health') {
			rate = part.values?.[idx] ?? 0;
			displayUnit = part.displayUnit ?? DEFAULT_BONUS_HEALTH_DISPLAY_UNIT;
		}
	}

	const bonusHealth = ctx.bonusHealth ?? 0;
	const bonusPercent = rate * bonusHealth;
	const total = flat + bonusPercent;

	const breakdown: SkillValueBreakdown = {
		flatPercent: flat,
		perBonusHealthRate: rate,
		perBonusHealthUnit: displayUnit,
		...(bonusHealth > 0 ? { bonusHealth, bonusPercent } : {}),
	};

	return {
		total: roundDisplay(total),
		formula: formatLifeStealFormula(breakdown),
		breakdown,
	};
}

function scaleBreakdown(breakdown: SkillValueBreakdown, factor: number): SkillValueBreakdown {
	return {
		baseDamage: breakdown.baseDamage !== undefined ? breakdown.baseDamage * factor : undefined,
		ratios: breakdown.ratios?.map((r) => ({
			stat: r.stat,
			ratio: r.ratio * factor,
			amount: r.amount * factor,
		})),
		flatPercent: breakdown.flatPercent !== undefined ? breakdown.flatPercent * factor : undefined,
		perBonusHealthRate:
			breakdown.perBonusHealthRate !== undefined ? breakdown.perBonusHealthRate * factor : undefined,
		perBonusHealthUnit: breakdown.perBonusHealthUnit,
		bonusHealth: breakdown.bonusHealth,
		bonusPercent: breakdown.bonusPercent !== undefined ? breakdown.bonusPercent * factor : undefined,
	};
}

function computeMultiplierField(
	field: SkillDataField,
	skill: ChampionSkill,
	ctx: SkillDescriptionContext,
	idx: number,
	cache: Map<string, ComputedField>,
): ComputedField {
	const baseKey = field.baseCalculation;
	if (!baseKey) {
		return { total: 0, formula: '0' };
	}

	const base = computeField(baseKey, skill, ctx, cache);
	const mult = field.multiplier?.values?.[idx] ?? field.multiplier?.constant ?? 0;
	const mode = field.multiplierMode ?? 'scale';

	if (mode === 'bonus') {
		const factor = 1 + mult;
		const scaled = scaleBreakdown(base.breakdown ?? {}, factor);
		return {
			total: Math.round(base.total * factor),
			formula: formatDamageFormula(scaled),
			breakdown: scaled,
		};
	}

	const scaled = scaleBreakdown(base.breakdown ?? {}, mult);
	return {
		total: Math.round(base.total * mult),
		formula: formatDamageFormula(scaled),
		breakdown: scaled,
	};
}

function computeDataValue(
	field: SkillDataField,
	idx: number,
	exprMultiplier?: number,
): ComputedField {
	let value = field.values?.[idx] ?? 0;
	if (exprMultiplier !== undefined) {
		value *= exprMultiplier;
	}
	const display = field.displayAsPercent || Math.abs(exprMultiplier ?? 1) === 100;
	const formula = display ? formatPercent(Math.abs(value)) : String(Math.round(Math.abs(value)));
	return {
		total: Math.round(Math.abs(value)),
		formula,
	};
}

function computeField(
	key: string,
	skill: ChampionSkill,
	ctx: SkillDescriptionContext,
	cache: Map<string, ComputedField>,
): ComputedField {
	if (cache.has(key)) return cache.get(key)!;

	const level = clampLevel(ctx.level, skill.maxRank);
	const idx = levelIndex(level);
	const raw = skill.data[key];

	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		const result = { total: 0, formula: '0' };
		cache.set(key, result);
		return result;
	}

	const field = raw as SkillDataField;
	let result: ComputedField;

	if (field.calculation === 'mFormulaParts') {
		if (field.formulaProfile === 'lifeSteal') {
			result = computeLifeStealFormula(field, ctx, idx);
		} else {
			result = computeDamageFormula(field, ctx, idx);
		}
	} else if (field.calculation === 'mMultiplier') {
		result = computeMultiplierField(field, skill, ctx, idx, cache);
	} else if (field.values) {
		result = computeDataValue(field, idx, field.displayMultiplier);
	} else {
		result = { total: 0, formula: '0' };
	}

	cache.set(key, result);
	return result;
}

function hasDamageFormulaBreakdown(breakdown?: SkillValueBreakdown): boolean {
	if (!breakdown) return false;
	return (
		(breakdown.ratios?.length ?? 0) > 0 ||
		(breakdown.baseDamage !== undefined && (breakdown.ratios?.some((r) => r.ratio !== 0) ?? false))
	);
}

function hasLifeStealBreakdown(breakdown?: SkillValueBreakdown): boolean {
	return breakdown?.flatPercent !== undefined && breakdown?.perBonusHealthRate !== undefined;
}

function buildDamageValueSegments(
	computed: ComputedField,
	key: string,
	style?: string,
): SkillDescriptionSegment[] {
	const contentRole: SkillSegmentRole = style ? tagToRole(style) : 'damage';
	const breakdown = computed.breakdown;

	if (!hasDamageFormulaBreakdown(breakdown)) {
		return [{ kind: 'number', value: computed.total, role: contentRole, style, key }];
	}

	const segments: SkillDescriptionSegment[] = [
		{ kind: 'number', value: computed.total, role: contentRole, style, key },
		{ kind: 'text', text: ' (', role: 'literal' },
	];

	const formulaParts: SkillDescriptionSegment[] = [];
	if (breakdown!.baseDamage !== undefined && breakdown!.baseDamage !== 0) {
		formulaParts.push({
			kind: 'number',
			value: Math.round(breakdown!.baseDamage),
			role: contentRole,
			style,
			key,
		});
	}

	for (const r of breakdown!.ratios ?? []) {
		if (r.ratio === 0) continue;
		if (formulaParts.length > 0) {
			formulaParts.push({ kind: 'text', text: ' + ', role: 'literal' });
		}
		formulaParts.push({
			kind: 'ratio',
			text: `${formatPercent(r.ratio)} ${r.stat}`,
			stat: r.stat,
			ratio: r.ratio,
			role: 'ratio',
			key,
		});
	}

	segments.push(...formulaParts);
	segments.push({ kind: 'text', text: ')', role: 'literal' });
	return segments;
}

function buildLifeStealValueSegments(
	computed: ComputedField,
	key: string,
	style?: string,
): SkillDescriptionSegment[] {
	const contentRole: SkillSegmentRole = 'healing';
	const b = computed.breakdown;
	if (!b || !hasLifeStealBreakdown(b)) {
		return [{ kind: 'number', value: computed.total, role: contentRole, style, key }];
	}

	const flat = b.flatPercent ?? 0;
	const rate = b.perBonusHealthRate ?? 0;
	const unit = b.perBonusHealthUnit ?? DEFAULT_BONUS_HEALTH_DISPLAY_UNIT;
	const bonusHealth = b.bonusHealth ?? 0;
	const bonusPercent = b.bonusPercent ?? rate * bonusHealth;
	const total = roundDisplay(flat + bonusPercent);

	const segments: SkillDescriptionSegment[] = [
		{ kind: 'number', value: total, role: contentRole, style: style ?? 'lifeSteal', key },
		{ kind: 'text', text: ' (+', role: 'literal' },
	];

	if (bonusHealth > 0) {
		segments.push({
			kind: 'number',
			value: roundDisplay(bonusPercent),
			role: contentRole,
			style: style ?? 'lifeSteal',
			key,
		});
		segments.push({
			kind: 'text',
			text: `% per ${bonusHealth} bonus health)`,
			role: 'literal',
		});
	} else {
		segments.push({
			kind: 'number',
			value: roundDisplay(rate * unit),
			role: contentRole,
			style: style ?? 'lifeSteal',
			key,
		});
		segments.push({
			kind: 'text',
			text: `% per ${unit} bonus health)`,
			role: 'literal',
		});
	}

	return segments;
}

function buildValueSegments(
	computed: ComputedField,
	field: SkillDataField | undefined,
	key: string,
	style?: string,
): SkillDescriptionSegment[] {
	if (field?.formulaProfile === 'lifeSteal') {
		return buildLifeStealValueSegments(computed, key, style);
	}
	if (field?.formulaProfile === 'damage') {
		return buildDamageValueSegments(computed, key, style);
	}

	const contentRole: SkillSegmentRole = style ? tagToRole(style) : 'literal';
	if (hasDamageFormulaBreakdown(computed.breakdown)) {
		return buildDamageValueSegments(computed, key, style);
	}

	return [{ kind: 'number', value: computed.total, role: contentRole, style, key }];
}

function parsePlaceholderExpr(expr: string): { key: string; displayMultiplier?: number } {
	const trimmed = expr.trim();
	if (SKIP_PLACEHOLDERS.has(trimmed.toLowerCase())) {
		return { key: '' };
	}
	const mulMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s*\*\s*(-?\d+(?:\.\d+)?)/);
	if (mulMatch) {
		return { key: mulMatch[1].toLowerCase(), displayMultiplier: parseFloat(mulMatch[2]) };
	}
	return { key: trimmed.replace(/\s+/g, '').toLowerCase() };
}

function parseInline(
	content: string,
	skill: ChampionSkill,
	ctx: SkillDescriptionContext,
	cache: Map<string, ComputedField>,
	style?: string,
): SkillDescriptionSegment[] {
	const segments: SkillDescriptionSegment[] = [];
	const regex = /\{\{\s*([^}]+)\s*\}\}/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;
	const trailingRole = style ? tagToRole(style) : undefined;

	while ((match = regex.exec(content)) !== null) {
		if (match.index > lastIndex) {
			segments.push({
				kind: 'text',
				text: content.slice(lastIndex, match.index),
				role: trailingRole,
				style,
			});
		}

		const { key, displayMultiplier } = parsePlaceholderExpr(match[1]);
		if (!key) {
			lastIndex = match.index + match[0].length;
			continue;
		}

		const field = skill.data[key] as SkillDataField | undefined;
		let computed: ComputedField;

		if (field && typeof field === 'object' && !Array.isArray(field)) {
			if (displayMultiplier !== undefined && field.values && !field.calculation) {
				computed = computeDataValue(field, levelIndex(clampLevel(ctx.level, skill.maxRank)), displayMultiplier);
			} else {
				computed = computeField(key, skill, ctx, cache);
			}
		} else {
			computed = { total: 0, formula: '0' };
		}

		segments.push(...buildValueSegments(computed, field, key, style ?? field?.type));
		lastIndex = match.index + match[0].length;
	}

	if (lastIndex < content.length) {
		segments.push({
			kind: 'text',
			text: content.slice(lastIndex),
			role: trailingRole,
			style,
		});
	}

	return segments;
}

function parseTaggedOrText(
	raw: string,
	skill: ChampionSkill,
	ctx: SkillDescriptionContext,
	cache: Map<string, ComputedField>,
): SkillDescriptionSegment[] {
	const cleaned = raw.replace(/\{\{\s*spellmodifierdescriptionappend\s*\}\}/gi, '');
	const segments: SkillDescriptionSegment[] = [];
	const pattern = /<(\w+)>([\s\S]*?)<\/\1>|([^<]+)/g;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(cleaned)) !== null) {
		if (match[1] && match[2] !== undefined) {
			const style = match[1];
			const role = tagToRole(style);
			const children = parseInline(match[2], skill, ctx, cache, style).map((child) => {
				if (child.kind === 'text' && !child.role) {
					return { ...child, role, style };
				}
				return child;
			});
			if (children.length > 0) {
				segments.push({ kind: 'styled', style, role, children });
			}
			continue;
		}

		const text = match[3];
		if (!text) continue;
		segments.push(...parseInline(text, skill, ctx, cache));
	}

	return segments;
}

function segmentToText(seg: SkillDescriptionSegment): string {
	if (seg.kind === 'text') return seg.text;
	if (seg.kind === 'number') return String(seg.value);
	if (seg.kind === 'ratio') return seg.text;
	if (seg.kind === 'styled') return seg.children.map(segmentToText).join('');
	return '';
}

function segmentsToText(segments: SkillDescriptionSegment[]): string {
	return segments.map(segmentToText).join('');
}

/** Build dynamic tooltip segments for UI rendering. Use `role` + `style` + `formulaProfile` to map colors. */
export function parseSkillDescription(
	skill: ChampionSkill,
	ctx: SkillDescriptionContext,
): ParsedSkillDescription {
	const cache = new Map<string, ComputedField>();
	const segments = parseTaggedOrText(skill.rawDescription, skill, ctx, cache);
	return {
		segments,
		text: segmentsToText(segments),
	};
}
