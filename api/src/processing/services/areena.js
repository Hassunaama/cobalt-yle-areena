import HLS from "hls-parser";
import { env, genericUserAgent } from "../../config.js";
import { join } from "path";

const APP_ID = "player_static_prod";
const APP_KEY = "8930d72170e48303cf5f3867780d549b";
const PLAYER_API_URL = "https://player.api.yle.fi/v1/preview";
const LOCATION_API_URL = `https://locations.api.yle.fi/v3/address/current?app_id=${APP_ID}&app_key=${APP_KEY}`;
const HEADERS = {
    "Referer": "https://areena.yle.fi",
    "Origin": "https://areena.yle.fi",
    "User-Agent": genericUserAgent
}

function getPlayerApiUrl(programId, countryCode) {
    return `${PLAYER_API_URL}/${programId}.json?ssl=true&countryCode=${countryCode}&host=yleareenafi&app_id=${APP_ID}&app_key=${APP_KEY}`;
};

function getPlayerData(apiRes) {
    if (apiRes.data.ongoing_ondemand) {
        return { data: apiRes.data.ongoing_ondemand }
    } else {
        if (apiRes.data.ongoing_ondemand || apiRes.data.ongoing_onchannel) {
            return { error: "content.video.live" }
        } else {
            return { error: "fetch.empty" }
        }
    }
}

async function fetchJSON(url, options, ...options2) {
    try {
        const res = await fetch(url, {
            headers: HEADERS,
            ...options
        }, ...options2);
        const resJSON = await res.json()
        return { resJSON, res };
    } catch {
        return;
    }
}

async function fetchText(url, options, ...options2) {
    try {
        const res = await fetch(url, {
            headers: HEADERS,
            ...options
        }, ...options2);
        const resText = await res.text()
        return { resText, res };
    } catch {
        return;
    }
}

export default async function(obj) {
    obj.id = `1-${obj.id}`;
    const quality = obj.quality === "max" ? 1080 : Number(obj.quality);

    // get country code
    const locationRes = await fetchJSON(LOCATION_API_URL);
    if (!locationRes?.res.ok) return { error: "fetch.fail" };

    // fetch player info
    const playerApiRes = await fetchJSON(getPlayerApiUrl(obj.id, locationRes.resJSON["country_code"]));
    if (!playerApiRes?.res.ok) return { error: "fetch.empty" };
    if (playerApiRes.resJSON.data["not_allowed"]) return { error: "content.video.unavailable" };

    // parse player info
    const playerApiData = getPlayerData(playerApiRes.resJSON);
    if (playerApiData.error) return { error: playerApiData.error };

    // check if duration is too long
    if (playerApiData.data.duration.duration_in_seconds >= env.durationLimit) return { error: "content.too_long" };

    // hls parse
    const m3u8 = await fetchText(playerApiData.data.manifest_url);

    if (!m3u8?.res.ok) return { error: "fetch.fail" };

    const parsedm3u8 = HLS.parse(m3u8.resText)
                        .variants
                        .filter(v => v.resolution && v.resolution.height != null);
    if (parsedm3u8.length === 0) {
        return { error: "fetch.empty" };
    }

    const matchingm3u8 = parsedm3u8.reduce((prev, next) => {
        const delta = {
            prev: Math.abs(quality - prev.resolution.height),
            next: Math.abs(quality - next.resolution.height)
        };

        return delta.prev < delta.next ? prev : next;
    });

    return {
        // broken right now
        urls: new URL(matchingm3u8.uri, playerApiData.data.manifest_url).href,
        isHLS: true,
        filenameAttributes: {
            service: "yle",
            id: obj.id,
            title: playerApiData.data.title.fin ?? obj.id,
            resolution: `${matchingm3u8.resolution.width}x${matchingm3u8.resolution.height}`,
            qualityLabel: `${matchingm3u8.resolution.height}p`,
            extension: "mp4"
        },
        fileMetadata: {
            title: playerApiData.data.title.fin ?? obj.id,
            description: playerApiData.data.description.fin ?? ""
        }
    };
}