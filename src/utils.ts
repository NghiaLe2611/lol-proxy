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

function modifyHweiDetail(data: ChampionRaw): ChampionRaw {
	const abilities = data.abilities as Record<string, unknown> | undefined;
	if (!abilities) return data;

	const hweiHud = `${assetUrl}/hwei/hud/icons2d`;

	// Map skill icons
	const applySubsetIcons = (slot: 'Q' | 'W' | 'E', combos: readonly [string, string, string]) => {
		const arr = abilities[slot];
		if (!Array.isArray(arr)) return;
		for (let i = 0; i < combos.length; i++) {
			const spell = arr[i + 1];
			if (spell && typeof spell === 'object')
				(spell as Record<string, unknown>).icon = `${hweiHud}/hwei${combos[i]}.png`;
		}
	};

	applySubsetIcons('Q', ['qq', 'qw', 'qe']);
	applySubsetIcons('W', ['wq', 'ww', 'we']);
	applySubsetIcons('E', ['eq', 'ew', 'ee']);

	const rSpells = abilities.R;
	if (Array.isArray(rSpells) && rSpells[1] && typeof rSpells[1] === 'object')
		(rSpells[1] as Record<string, unknown>).icon = `${hweiHud}/hweiwashbrush.png`;

	return data;
}

// Transform champion detail
function modifyChampionDetail(data: ChampionRaw): ChampionRaw {
	const key = data.key;
	if (typeof key !== 'string') return data;

	switch (key) {
		case 'Aatrox':
			return modifyAatroxDetail(structuredClone(data));
		case 'Hwei':
			return modifyHweiDetail(structuredClone(data));
		default:
			return data;
	}
}

export { modifyAatroxDetail, modifyChampionDetail, modifyHweiDetail };
