/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

// export default {
// 	async fetch(request, env, ctx): Promise<Response> {
// 		return new Response("Hello World!");
// 	},
// } satisfies ExportedHandler<Env>;

import { Hono } from 'hono';
import { cors } from 'hono/cors';

type ErrWithStatus = Error & { statusCode: number };

/** Dev: `"*"`. Production: comma-separated origins in `CORS_ALLOWED_ORIGINS` (wrangler `env.production`). */
function corsOriginFromEnv(allowedOrigins: string | undefined): string | string[] {
	const raw = (allowedOrigins ?? '*').trim();
	if (raw === '*') return '*';
	const list = raw
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	return list.length > 0 ? list : '*';
}

function upstreamError(response: Response): ErrWithStatus {
	const err = new Error(`Request failed: ${response.status} ${response.statusText}`) as ErrWithStatus;
	err.statusCode = response.status;
	return err;
}

function handleRouteError(e: unknown): Response {
	const statusCode =
		e !== null && typeof e === 'object' && 'statusCode' in e && typeof (e as { statusCode: unknown }).statusCode === 'number'
			? (e as { statusCode: number }).statusCode
			: 500;
	const message = e instanceof Error ? e.message : String(e);
	const payload = { statusCode, message };
	console.log(payload);
	return new Response(JSON.stringify(payload), {
		status: statusCode,
		headers: { 'content-type': 'application/json' },
	});
}

const app = new Hono<{ Bindings: Env }>();

const MERAKI_API_URL = 'https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US';

type ChampionRaw = Record<string, unknown>;

type ChampionSlim = {
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

function slimChampion(raw: ChampionRaw): ChampionSlim {
	return {
		id: raw.id,
		key: raw.key,
		name: raw.name,
		title: raw.title,
		icon: raw.icon,
		resource: raw.resource,
		attackType: raw.attackType,
		adaptiveType: raw.adaptiveType,
		positions: raw.positions,
		roles: raw.roles,
		attributeRatings: raw.attributeRatings,
		releaseDate: raw.releaseDate,
		patchLastChanged: raw.patchLastChanged,
		releasePatch: raw.releasePatch,
		price: raw.price,
	} as ChampionSlim;
}

/** Mutates `data`. */
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
		'https://raw.communitydragon.org/latest/game/assets/characters/aatrox/hud/icons2d/aatrox_q.png',
		'https://raw.communitydragon.org/latest/game/assets/characters/aatrox/hud/icons2d/aatrox_q2.png',
		'https://raw.communitydragon.org/latest/game/assets/characters/aatrox/hud/icons2d/aatrox_q3.png',
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

/** Transform champion detail từ Meraki; switch theo `key` (vd. Aatrox), không đổi tướng khác. */
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

app.use('*', async (c, next) => {
	const origin = corsOriginFromEnv(c.env.CORS_ALLOWED_ORIGINS);
	const allowCredentials = origin !== '*';
	return cors({
		origin,
		allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
		allowHeaders: ['Content-Type', 'Authorization'],
		credentials: allowCredentials,
	})(c, next);
});

app.get('/', (c: any) => {
	return c.json({
		env: c.env.APP_ENV,
		// corsAllowedOrigins: c.env.CORS_ALLOWED_ORIGINS,
	});
});

// Get all champions
app.get('/champions', async (c) => {
	try {
		const response = await fetch(`${MERAKI_API_URL}/champions.json`);
		if (!response.ok) throw upstreamError(response);

		const data = (await response.json()) as Record<string, ChampionRaw>;

		const list = Object.values(data).map(slimChampion);

		return c.json(list);
	} catch (e) {
		return handleRouteError(e);
	}
});

// Get champion detail
app.get('/champions/:id', async (c) => {
	try {
		const id = c.req.param('id');

		const response = await fetch(`${MERAKI_API_URL}/champions/${id}.json`);
		if (!response.ok) throw upstreamError(response);

		const data = (await response.json()) as ChampionRaw;

		return c.json(modifyChampionDetail(data));
	} catch (e) {
		return handleRouteError(e);
	}
});

export default app;
