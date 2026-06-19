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
import { ChampionRaw, ChampionSlim } from './types';
import { modifyChampionDetail } from './utils';

type ItemRaw = Record<string, unknown>;

const ITEM_GROUP_BY_ID = new Map<number, string>([
	// Hydra
	[3077, 'Hydra'],
	[6698, 'Hydra'],
	[3074, 'Hydra'],
	[6631, 'Hydra'],
	[3748, 'Hydra'],
	// Jungle
	[1101, 'Jungle'],
	[1102, 'Jungle'],
	[1103, 'Jungle'],
	// Manaflow
	[3003, 'Manaflow'],
	[3121, 'Manaflow'],
	[3004, 'Manaflow'],
	[3042, 'Manaflow'],
	[3040, 'Manaflow'],
	[3070, 'Manaflow'],
	[3119, 'Manaflow'],
	// Spellblade
	[3057, 'Spellblade'],
	[6662, 'Spellblade'],
	[3100, 'Spellblade'],
	[3078, 'Spellblade'],
	// Stasis
	[2420, 'Stasis'],
	[3157, 'Stasis'],
	// Starter Support
	[3867, 'Starter Support'],
	[3877, 'Starter Support'],
	[3869, 'Starter Support'],
	[3870, 'Starter Support'],
	[3871, 'Starter Support'],
	[3876, 'Starter Support'],
	// Fatality
	[3035, 'Fatality'],
	[3071, 'Fatality'],
	[3036, 'Fatality'],
	[3033, 'Fatality'],
	[6694, 'Fatality'],
	[3302, 'Fatality'],
	// Lifeline
	[3003, 'Lifeline'],
	[3155, 'Lifeline'],
	[6673, 'Lifeline'],
	[3156, 'Lifeline'],
	[3040, 'Lifeline'],
	[3053, 'Lifeline'],
	// Eternity
	[3803, 'Eternity'],
	[6657, 'Eternity'],
	// Quicksilver
	[3139, 'Quicksilver'],
	[3140, 'Quicksilver'],
]);

function itemRank(item: ItemRaw): string[] {
	const rank = item.rank;
	if (!Array.isArray(rank)) return [];
	return rank.filter((r): r is string => typeof r === 'string');
}

function resolveItemGroup(item: ItemRaw): string | undefined {
	const id = item.id;
	if (typeof id === 'number') {
		const byId = ITEM_GROUP_BY_ID.get(id);
		if (byId) return byId;
	}

	const name = typeof item.name === 'string' ? item.name : '';
	const rank = itemRank(item);

	if (name.includes('Doran') && rank.includes('STARTER')) return 'Starter';
	if (rank.includes('TRINKET')) return 'Trinket';
	if (rank.includes('BOOTS')) return 'Boots';

	return undefined;
}

function modifyItems(items: ItemRaw[]): Array<ItemRaw & { group?: string }> {
	return items.map((item) => {
		const group = resolveItemGroup(item);
		return group ? { ...item, group } : item;
	});
}

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

// Get items
app.get('/items', async (c) => {
	try {
		const response = await fetch(`${MERAKI_API_URL}/items.json`);
		if (!response.ok) throw upstreamError(response);

		const data = (await response.json()) as Record<string, ItemRaw>;
		const list = modifyItems(Object.values(data));
		return c.json(list);
	} catch (e) {
		return handleRouteError(e);
	}
});

export default app;
