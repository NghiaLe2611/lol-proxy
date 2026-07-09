import { describe, it, expect } from 'vitest';
import type { DdragonSpell } from '../src/types';
import { buildChampionSkillsFromBin, fetchChampionSkills } from '../src/skills';

const VERSION = '16.13.1';
const LANG = 'en_US';

async function loadDdragonSpells(championId: string): Promise<DdragonSpell[]> {
	const res = await fetch(
		`https://ddragon.leagueoflegends.com/cdn/${VERSION}/data/${LANG}/champion/${championId}.json`,
	);
	expect(res.ok).toBe(true);
	const json = (await res.json()) as { data?: Record<string, { spells?: DdragonSpell[] }> };
	const slug = championId.toLowerCase();
	const key =
		Object.keys(json.data ?? {}).find((k) => k.toLowerCase() === slug) ?? championId;
	const spells = json.data?.[key]?.spells;
	expect(spells?.length).toBeGreaterThan(0);
	return spells!;
}

async function loadBin(slug: string): Promise<Record<string, unknown>> {
	const res = await fetch(
		`https://raw.communitydragon.org/latest/game/data/characters/${slug}/${slug}.bin.json`,
	);
	expect(res.ok).toBe(true);
	return (await res.json()) as Record<string, unknown>;
}

describe('buildChampionSkillsFromBin', () => {
	it('handles Zed with name-only SpellDataValue (RBaseDamage)', async () => {
		const [bin, spells] = await Promise.all([loadBin('zed'), loadDdragonSpells('Zed')]);
		const skills = buildChampionSkillsFromBin(bin, spells);

		expect(skills).toHaveLength(4);
		expect(skills[3].id).toBe('ZedR');
		expect(skills[3].data.rbasedamage).toBeUndefined();
		expect(skills[3].data.rcalculateddamage).toBeDefined();
	});

	it('handles Aatrox without errors', async () => {
		const [bin, spells] = await Promise.all([loadBin('aatrox'), loadDdragonSpells('Aatrox')]);
		const skills = buildChampionSkillsFromBin(bin, spells);
		expect(skills).toHaveLength(4);
	});
});

describe('fetchChampionSkills', () => {
	it('fetches Zed from live sources', async () => {
		const skills = await fetchChampionSkills('Zed', VERSION, LANG);
		expect(skills).toHaveLength(4);
	});
});
