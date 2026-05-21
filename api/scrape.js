const FINANCE_ID = 153;
const OWNER = "brntsllvn";
const REPO = "substack-leaderboard";
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
  if (!res.ok) throw new Error(`${res.status} fetching ${apiType} page ${page}`);
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
      author_handle: user.handle || "",
      pub_id: pub.id || null,
    };
  });
}

async function ghGet(path, pat) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
    headers: { Authorization: `token ${pat}`, Accept: "application/vnd.github.v3+json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${path}: ${res.status}`);
  return res.json();
}

async function ghPut(path, content, message, sha, pat) {
  const body = { message, content: Buffer.from(content).toString("base64") };
  if (sha) body.sha = sha;
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
    method: "PUT",
    headers: {
      Authorization: `token ${pat}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub PUT ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

module.exports = async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const pat = process.env.GITHUB_PAT;
  if (!pat) return res.status(500).json({ error: "GITHUB_PAT not configured" });

  const today = new Date().toISOString().split("T")[0];

  const existing = await ghGet(`data/${today}.json`, pat);
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

  await ghPut(`data/${today}.json`, JSON.stringify(data, null, 2), `data: ${today}`, null, pat);

  const indexFile = await ghGet("data/index.json", pat);
  const idx = indexFile
    ? JSON.parse(Buffer.from(indexFile.content, "base64").toString())
    : { dates: [] };
  if (!idx.dates.includes(today)) {
    idx.dates.push(today);
    idx.dates.sort();
  }
  await ghPut("data/index.json", JSON.stringify(idx, null, 2), `index: ${today}`, indexFile?.sha || null, pat);

  return res.status(200).json({
    success: true,
    date: today,
    rising: data.rising.length,
    paid: data.paid.length,
    ...(errors.length && { errors }),
  });
};
