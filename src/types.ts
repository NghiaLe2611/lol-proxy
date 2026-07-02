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

export type DdragonSpell = {
	id: string;
	name: string;
	description: string;
	tooltip: string;
	maxrank: number;
	cooldown: number[];
	cost: number[];
	range: number[];
};

export type SkillFormulaPart = {
	kind: 'base' | 'ratio' | 'coefficient' | 'interpolation';
	dataValue?: string;
	stat?: string;
	coefficient?: number;
	values?: number[];
};

export type SkillDataField = {
	values?: number[];
	type?: string;
	calculation?: 'mFormulaParts' | 'mMultiplier';
	parts?: SkillFormulaPart[];
	baseCalculation?: string;
	multiplier?: { dataValue?: string; values?: number[]; constant?: number };
	multiplierMode?: 'scale' | 'bonus';
	displayMultiplier?: number;
	displayAsPercent?: boolean;
	scalarMultiplier?: number;
};

export type ChampionSkill = {
	id: string;
	name: string;
	description: string;
	rawDescription: string;
	maxRank: number;
	data: Record<string, SkillDataField | number[] | number | undefined>;
};

export type SkillDescriptionContext = {
	/** Skill rank (1–maxRank) */
	level: number;
	ad: number;
	ap: number;
	/** Champion level for interpolation formulas (default 18) */
	championLevel?: number;
};

export type SkillValueBreakdown = {
	base?: number;
	ratios?: { stat: string; ratio: number; amount: number }[];
};

export type SkillSegmentRole =
	| 'literal'
	| 'damage'
	| 'ratio'
	| 'status'
	| 'speed'
	| 'healing'
	| 'scale'
	| 'recast'
	| 'passive'
	| 'active';

export type SkillDescriptionSegment =
	| { kind: 'text'; text: string; role?: SkillSegmentRole; style?: string }
	| { kind: 'number'; value: number; role: SkillSegmentRole; style?: string; key?: string }
	| { kind: 'ratio'; text: string; stat: string; ratio: number; role: 'ratio'; key?: string }
	| { kind: 'styled'; style: string; role: SkillSegmentRole; children: SkillDescriptionSegment[] };

export type ParsedSkillDescription = {
	segments: SkillDescriptionSegment[];
	/** Plain text (no styling) for quick preview */
	text: string;
};
