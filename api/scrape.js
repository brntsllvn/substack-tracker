const FINANCE_ID = 153;
const LIST_TYPES = { rising: "trending", paid: "paid" };
const OWNER = "brntsllvn";
const REPO = "substack-tracker";
const GH = "https://api.github.com";

async function ghGet(path, pat) {
  const r = await fetch(`${GH}/repos/${OWNER}/${REPO}/contents/${path}`, {
    headers: { Authorization: `token ${pat}`, Accept: "application/vnd.github.v3+json" },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub GET ${path}: ${r.status}`);
  return r.json();
}

async function ghPut(path, content, message, sha, pat) {
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
  if (!r.ok) throw new Error(`GitHub PUT ${path}: ${r.status} ${await r.text()}`);
}

async function fetchPage(apiType, page) {
  const r = await fetch(
    `https://substack.com/api/v1/category/leaderboard/${FINANCE_ID}/${apiType}?page=${page}`,
    {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json",
        Referer: "https://substack.com/",
      },
    }
  );
  if (!r.ok) throw new Error(`${r.status} from Substack (${apiType} page ${page})`);
  return r.json();
}

async function fetchTop100(listKey) {
  const apiType = LIST_TYPES[listKey];
  const items = [];
  let page = 0;
  while (items.length < 100) {
    const { items: batch, more } = await fetchPage(apiType, page);
    items.push(...batch);
    if (!more) break;
    page++;
  }
  return items.slice(0, 100).map((item, i) => {
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
}

module.exports = async function handler(req, res) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const pat = process.env.GITHUB_PAT;
    if (!pat) return res.status(500).json({ error: "GITHUB_PAT not set" });

    const today = new Date().toISOString().split("T")[0];
    const dataPath = `data/${today}.json`;

    const existing = await ghGet(dataPath, pat);
    if (existing) {
      return res.status(200).json({ message: "Already scraped today", date: today });
    }

    const data = { date: today, rising: [], paid: [] };
    const errors = [];

    for (const listKey of ["rising", "paid"]) {
      try {
        data[listKey] = await fetchTop100(listKey);
      } catch (e) {
        errors.push(`${listKey}: ${e.message}`);
      }
    }

    if (errors.length === 2) {
      return res.status(500).json({ error: "All fetches failed", errors });
    }

    const json = JSON.stringify(data, null, 2);
    await ghPut(dataPath, json, `data: ${today}`, null, pat);

    const indexFile = await ghGet("data/index.json", pat);
    const idx = indexFile
      ? JSON.parse(Buffer.from(indexFile.content, "base64").toString())
      : { dates: [] };
    if (!idx.dates.includes(today)) {
      idx.dates.push(today);
      idx.dates.sort();
    }
    await ghPut("data/index.json", JSON.stringify(idx, null, 2), `index: ${today}`, indexFile?.sha || null, pat);

    const deployHook = process.env.VERCEL_DEPLOY_HOOK;
    if (deployHook) await fetch(deployHook, { method: "POST" }).catch(() => {});

    return res.status(200).json({
      success: true,
      date: today,
      rising: data.rising.length,
      paid: data.paid.length,
      ...(errors.length && { errors }),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
