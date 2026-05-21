const { put, list } = require("@vercel/blob");

const FINANCE_ID = 153;
const GH_REPO = "brntsllvn/substack-leaderboard";

async function githubCommit(path, content, date) {
  const pat = process.env.GITHUB_PAT;
  if (!pat) return; // backup is best-effort
  const url = `https://api.github.com/repos/${GH_REPO}/contents/${path}`;
  const headers = {
    Authorization: `token ${pat}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
  };
  // Check if file already exists (need sha to update)
  const existing = await fetch(url, { headers }).then(r => r.ok ? r.json() : null);
  if (existing) return; // already backed up
  await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: `data: ${date}`,
      content: Buffer.from(content).toString("base64"),
    }),
  });
}
const LIST_TYPES = { rising: "trending", paid: "paid" };

async function fetchPage(apiType, page) {
  const url = `https://substack.com/api/v1/category/leaderboard/${FINANCE_ID}/${apiType}?page=${page}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "application/json",
      Referer: "https://substack.com/",
    },
  });
  if (!res.ok) throw new Error(`${res.status} from Substack (${apiType} page ${page})`);
  return res.json();
}

async function fetchTop100(listKey) {
  const apiType = LIST_TYPES[listKey];
  const allItems = [];
  let page = 0;
  while (allItems.length < 100) {
    const { items, more } = await fetchPage(apiType, page);
    allItems.push(...items);
    if (!more) break;
    page++;
  }
  return allItems.slice(0, 100).map((item, i) => {
    const pub = item.publication || {};
    const user = item.user || {};
    const lb = ((user.status || {}).leaderboard) || {};
    return {
      rank: lb.rank || i + 1,
      name: pub.name || "",
      subdomain: pub.subdomain || "",
      url: pub.base_url || "",
      logo_url: pub.logo_url || "",
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

    const today = new Date().toISOString().split("T")[0];
    const prefix = `leaderboard/${today}`;

    const { blobs } = await list({ prefix });
    if (blobs.length > 0) {
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

    await put(`${prefix}.json`, json, {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
    });

    await githubCommit(`data/${today}.json`, json, today);

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
