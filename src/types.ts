export type ChampionRaw = Record<string, unknown>;

export type ChampionSlim = {
	id: number;
	key: string;
	name: string;
	title?: string;
	icon?: string;
	resource?: unknown;
	attackType?: string;
	adaptiveType?: string;
	positions?: unknown;
	roles?: unknown;
	attributeRatings?: unknown;
	releaseDate?: unknown;
	patchLastChanged?: unknown;
	releasePatch?: unknown;
	price?: unknown;
};