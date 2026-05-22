import { ChampionRaw } from './types';

const assetUrl = 'https://raw.communitydragon.org/latest/game/assets/characters';

// Mutate data
function modifyAatroxDetail(data: ChampionRaw): ChampionRaw {
	const abilities = data.abilities as Record<string, unknown> | undefined;
	if (!abilities?.Q || !Array.isArray(abilities.Q)) return data;

	const qSpells = abilities.Q as Record<string, unknown>[];
	for (const spell of qSpells) {
		if (spell && typeof spell === 'object') spell.icon = null;
	}

	const firstSpell = qSpells[0];
	const effects = firstSpell?.effects;
	if (!Array.isArray(effects)) return data;

	const effectIcons = [
		`${assetUrl}/aatrox/hud/icons2d/aatrox_q.png`,
		`${assetUrl}/aatrox/hud/icons2d/aatrox_q2.png`,
		`${assetUrl}/aatrox/hud/icons2d/aatrox_q3.png`,
	];
	// 3Q of Aatrox
	const effectIndices = [2, 3, 4];
	for (let i = 0; i < effectIcons.length; i++) {
		const idx = effectIndices[i];
		const eff = effects[idx];
		if (eff && typeof eff === 'object') (eff as Record<string, unknown>).icon = effectIcons[i];
	}

	return data;
}

// Transform champion detail
function modifyChampionDetail(data: ChampionRaw): ChampionRaw {
	const key = data.key;
	if (typeof key !== 'string') return data;

	switch (key) {
		case 'Aatrox':
			return modifyAatroxDetail(structuredClone(data));
		default:
			return data;
	}
}

export { modifyAatroxDetail, modifyChampionDetail };
