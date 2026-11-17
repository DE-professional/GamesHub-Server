import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";

// Thin client for the two Steam endpoints Price Is Nice needs. Every response is validated
// with zod; nothing from Steam reaches the database unchecked.

const TIMEOUT_MS = 20_000;
const ATTEMPTS = 3;

// GetAppList returns at most 50,000 apps per page; there are a few pages of games.
const APP_LIST_PAGE_SIZE = 50_000;
const MAX_APP_LIST_PAGES = 10;

// Steam couldn't be reached, kept failing, or answered with something unusable.
// Messages never contain the request URL: the app list URL carries the API key.
export class SteamUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SteamUnavailableError";
    }
}

// GETs JSON, retrying network errors, timeouts, 429 and 5xx with a short back-off.
// Any other 4xx means the request itself is wrong and is not retried.
async function getJson(url: string, label: string): Promise<unknown> {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        let status: number | undefined;
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
            status = res.status;
            if (res.ok) return await res.json();
        } catch {
            // Network error, timeout, or a body that isn't JSON: retry.
        }
        if (status !== undefined && status !== 429 && status >= 400 && status < 500) {
            throw new SteamUnavailableError(`${label}: HTTP ${status}`);
        }
        if (attempt < ATTEMPTS) await sleep(attempt * 1000);
    }
    throw new SteamUnavailableError(`${label}: no usable response after ${ATTEMPTS} attempts`);
}

const appListPageSchema = z.object({
    response: z.object({
        apps: z.array(z.object({ appid: z.int() })).default([]),
        have_more_results: z.boolean().optional(),
        last_appid: z.int().optional(),
    }),
});

// Every game's app id on the Steam store (no DLC, software, videos or hardware).
export async function fetchAppIds(apiKey: string): Promise<number[]> {
    const ids: number[] = [];
    let lastAppId: number | undefined;

    for (let page = 0; page < MAX_APP_LIST_PAGES; page++) {
        const params = new URLSearchParams({
            key: apiKey,
            include_games: "true",
            include_dlc: "false",
            include_software: "false",
            include_videos: "false",
            include_hardware: "false",
            max_results: String(APP_LIST_PAGE_SIZE),
        });
        if (lastAppId !== undefined) params.set("last_appid", String(lastAppId));

        const body = appListPageSchema.safeParse(
            await getJson(`https://api.steampowered.com/IStoreService/GetAppList/v1/?${params}`, "Steam app list"),
        );
        if (!body.success) throw new SteamUnavailableError("Steam app list: unexpected response shape");

        const { apps, have_more_results, last_appid } = body.data.response;
        for (const app of apps) ids.push(app.appid);
        if (!have_more_results || last_appid === undefined) break;
        lastAppId = last_appid;
    }
    return ids;
}

// The fields of an appdetails "data" object that Price Is Nice uses. Unknown fields are dropped.
const appDetailsSchema = z.object({
    name: z.string(),
    short_description: z.string().default(""),
    // A number in practice; older listings have strings such as "17+".
    required_age: z.union([z.int(), z.string()]).optional(),
    // Absent for free and unreleased games. `final` is in cents, after any discount.
    price_overview: z.object({ currency: z.string(), final: z.int(), final_formatted: z.string() }).optional(),
    content_descriptors: z.object({ ids: z.array(z.int()).nullish() }).nullish(),
    genres: z.array(z.object({ description: z.string() })).optional(),
    screenshots: z.array(z.object({ path_full: z.url({ protocol: /^https$/ }) })).optional(),
});

export type SteamAppDetails = z.infer<typeof appDetailsSchema>;

const appDetailsEnvelopeSchema = z.record(
    z.string(),
    z.object({ success: z.boolean(), data: z.unknown().optional() }),
);

// One app's store listing with US prices and English text, or null when Steam answered but has
// no usable listing (unlisted, region-locked, or an unexpected shape).
export async function fetchAppDetails(appId: number): Promise<SteamAppDetails | null> {
    const id = String(appId);
    const body = await getJson(
        `https://store.steampowered.com/api/appdetails?appids=${id}&cc=us&l=english`,
        "Steam app details",
    );

    // The body is keyed by the app id: {"620": {"success": true, "data": {...}}}
    const envelope = appDetailsEnvelopeSchema.safeParse(body);
    if (!envelope.success) return null;
    const result = envelope.data[id];
    if (result === undefined || !result.success) return null;

    const details = appDetailsSchema.safeParse(result.data);
    return details.success ? details.data : null;
}
