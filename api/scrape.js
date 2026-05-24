const { sendAlert } = require("./_notify");

const FINANCE_ID = 153;
const LIST_TYPES = { rising: "trending", paid: "paid" };
const OWNER = "brntsllvn";
const REPO = "substack-tracker";
const GH = "https://api.github.com";

const ts = () => new Date().toISOString();
const log  = (...a) => console.log( `[${ts()}]`, ...a);
const warn = (...a) => console.warn( `[${ts()}]`, ...a);
const err  = (...a) => console.error(`[${ts()}]`, ...a);

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function retry(label, fn, attempts = 3, delayMs = 1000) {
  for (let i = 0; i < attempts; i++) {
    const t0 = Date.now();
    try {
      const result = await fn();
      log(`${label} OK (attempt ${i + 1}, ${Date.now() - t0}ms)`);
      return result;
    } catch (e) {
      const elapsed = Date.now() - t0;
      if (i === attempts - 1) {
        err(`${label} FAILED after ${attempts} attempts (last took ${elapsed}ms): ${e.message}`);
        throw e;
      }
      const wait = delayMs * (i + 1);
      warn(`${label} attempt ${i + 1} failed (${elapsed}ms): ${e.message}, retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
}

async function ghGet(path, pat) {
  return retry(`GH GET ${path}`, async () => {
    const r = await fetch(`${GH}/repos/${OWNER}/${REPO}/contents/${path}`, {
      headers: { Authorization: `token ${pat}`, Accept: "application/vnd.github.v3+json" },
    });
    log(`GH GET ${path} -> HTTP ${r.status}`);
    if (r.status === 404) return null;
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`HTTP ${r.status}: ${body}`);
    }
    return r.json();
  });
}

async function ghPut(path, content, message, sha, pat) {
  return retry(`GH PUT ${path}`, async () => {
    const body = { message, content: Buffer.from(content).toString("base64") };
    if (sha) body.sha = sha;
    const r = await fetch(`${GH}/repos/${OWNER}/${REPO}/contents/${path}`, {
      method: "PUT",
      headers: {
        Authorization: `token ${pat}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    log(`GH PUT ${path} -> HTTP ${r.status}`);
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`HTTP ${r.status}: ${body}`);
    }
  });
}

async function fetchPage(apiType, page) {
  const url = `https://substack.com/api/v1/category/leaderboard/${FINANCE_ID}/${apiType}?page=${page}`;
  return retry(`Substack ${apiType} page ${page}`, async () => {
    log(`GET ${url}`);
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json",
        Referer: "https://substack.com/",
      },
    });
    log(`Substack ${apiType} page ${page} -> HTTP ${r.status}`);
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`);
    }
    return r.json();
  });
}

async function fetchTop100(listKey) {
  const apiType = LIST_TYPES[listKey];
  log(`fetchTop100: starting ${listKey} (api type: ${apiType})`);
  const items = [];
  let page = 0;
  while (items.length < 100) {
    const { items: batch, more } = await fetchPage(apiType, page);
    log(`fetchTop100 ${listKey} page ${page}: got ${batch.length} items, more=${more}`);
    items.push(...batch);
    if (!more) break;
    page++;
  }
  const result = items.slice(0, 100).map((item, i) => {
    const pub = item.publication || {};
    const user = item.user || {};
    return {
      rank: i + 1,
      name: pub.name || "",
      subdomain: pub.subdomain || "",
      url: pub.base_url || "",
      logo_url: pub.logo_url || pub.primary_profile_photo_url || pub.author_photo_url || user.photo_url || "",
      author: user.name || "",
      pub_id: pub.id || null,
    };
  });
  log(`fetchTop100 ${listKey}: done, ${result.length} items across ${page + 1} pages`);
  return result;
}

module.exports = async function handler(req, res) {
  const t0 = Date.now();
  log(`--- scrape invoked method=${req.method} url=${req.url}`);
  log(`env: GITHUB_PAT=${process.env.GITHUB_PAT ? `set (${process.env.GITHUB_PAT.length} chars)` : "MISSING"} CRON_SECRET=${process.env.CRON_SECRET ? "set" : "not set"}`);

  try {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const authHeader = req.headers.authorization || "(none)";
      if (authHeader !== `Bearer ${cronSecret}`) {
        err(`Auth failed. Got: "${authHeader.slice(0, 20)}..." Expected Bearer <CRON_SECRET>`);
        return res.status(401).json({ error: "Unauthorized" });
      }
      log("Auth: OK");
    } else {
      log("Auth: no CRON_SECRET set, skipping check");
    }

    const pat = process.env.GITHUB_PAT;
    if (!pat) {
      err("GITHUB_PAT is not set, cannot commit to GitHub");
      return res.status(500).json({ error: "GITHUB_PAT not set" });
    }

    const today = new Date().toISOString().split("T")[0];
    const dataPath = `data/${today}.json`;
    log(`today=${today}, checking if ${dataPath} already exists`);

    const existing = await ghGet(dataPath, pat);
    if (existing) {
      log(`${dataPath} already exists, skipping scrape`);
      return res.status(200).json({ message: "Already scraped today", date: today });
    }
    log(`${dataPath} not found, proceeding with scrape`);

    const data = { date: today, rising: [], paid: [] };
    const errors = [];

    for (const listKey of ["rising", "paid"]) {
      const t1 = Date.now();
      try {
        data[listKey] = await fetchTop100(listKey);
        log(`${listKey}: ${data[listKey].length} items in ${Date.now() - t1}ms`);
      } catch (e) {
        err(`${listKey} fetch FAILED after ${Date.now() - t1}ms: ${e.message}`);
        errors.push(`${listKey}: ${e.message}`);
      }
    }

    if (errors.length === 2) {
      err("Both rising and paid fetches failed, aborting without commit");
      await sendAlert(`Scrape FAILED: no data for ${today}`, [
        "Both rising and paid list fetches failed after 3 attempts each.",
        "",
        ...errors.map(e => `  • ${e}`),
      ]);
      return res.status(500).json({ error: "All fetches failed", errors });
    }

    log(`Writing ${dataPath} (${JSON.stringify(data).length} bytes)`);
    await ghPut(dataPath, JSON.stringify(data, null, 2), `data: ${today}`, null, pat);

    log("Fetching current index.json");
    const indexFile = await ghGet("data/index.json", pat);
    const idx = indexFile
      ? JSON.parse(Buffer.from(indexFile.content, "base64").toString())
      : { dates: [] };
    log(`index.json: ${idx.dates.length} existing dates, sha=${indexFile?.sha || "none"}`);

    if (!idx.dates.includes(today)) {
      idx.dates.push(today);
      idx.dates.sort();
    }
    await ghPut("data/index.json", JSON.stringify(idx, null, 2), `index: ${today}`, indexFile?.sha || null, pat);

    const total = Date.now() - t0;
    log(`--- scrape DONE in ${total}ms: rising=${data.rising.length} paid=${data.paid.length}`);

    return res.status(200).json({
      success: true,
      date: today,
      rising: data.rising.length,
      paid: data.paid.length,
      elapsed_ms: total,
      ...(errors.length && { errors }),
    });
  } catch (e) {
    const total = Date.now() - t0;
    err(`--- scrape UNHANDLED ERROR after ${total}ms: ${e.message}`);
    err(e.stack);
    await sendAlert(`Scrape FAILED: unhandled error for ${new Date().toISOString().split("T")[0]}`, [
      `Error: ${e.message}`,
      "",
      e.stack || "(no stack)",
    ]);
    return res.status(500).json({ error: e.message, elapsed_ms: total });
  }
};
