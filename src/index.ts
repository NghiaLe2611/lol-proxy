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
import { ITEM_GROUP_BY_ID } from './constants';
import { fetchChampionSkills } from './skills';
import { parseSkillDescription } from './skillDescription';

const VERSION = '16.13.1';

type ItemRaw = Record<string, unknown>;

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
	// console.log(payload);
	return new Response(JSON.stringify(payload), {
		status: statusCode,
		headers: { 'content-type': 'application/json' },
	});
}

const app = new Hono<{ Bindings: Env }>();

const MERAKI_API_URL = process.env.MERAKI_API_URL;

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
		// merakiApiUrl: c.env.MERAKI_API_URL,
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

// Get skills (CommunityDragon bin + Data Dragon)
app.get('/skills/:id', async (c) => {
	try {
		const id = c.req.param('id');
		const version = c.req.query('version') ?? VERSION;
		const lang = c.req.query('lang') ?? 'en_US';

		const skills = await fetchChampionSkills(id, version, lang);
		// const skillQ = skills[0];
		// const desc = parseSkillDescription(skillQ, { level: 1, ad: 70, ap: 0 });
		// return c.json(desc);
		return c.json(skills);
	} catch (e) {
		return handleRouteError(e);
	}
});

export default app;
