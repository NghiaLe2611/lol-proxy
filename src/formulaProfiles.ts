/** Tooltip HTML tags that scale off champion AD/AP (damage formulas). */
export const DAMAGE_TAGS = new Set(['physicalDamage', 'magicDamage', 'trueDamage']);

/** Tooltip tags for omnivamp / spell vamp style formulas (not damage). */
export const LIFE_STEAL_TAGS = new Set(['lifeSteal']);

export type FormulaProfile = 'damage' | 'lifeSteal' | 'generic';

export function getFormulaProfile(tag?: string): FormulaProfile {
	if (tag && DAMAGE_TAGS.has(tag)) return 'damage';
	if (tag && LIFE_STEAL_TAGS.has(tag)) return 'lifeSteal';
	return 'generic';
}

/** Only used when resolving AD/AP ratio parts in damage formulas. */
export const DAMAGE_STAT_BY_ID: Record<number, string> = {
	2: 'AD',
	3: 'AP',
};

/** Default bonus-health bucket shown when UI has no simulated bonus HP. */
export const DEFAULT_BONUS_HEALTH_DISPLAY_UNIT = 100;
