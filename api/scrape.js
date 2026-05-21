const FINANCE_ID = 153;
const LIST_TYPES = { rising: "trending", paid: "paid" };
const BLOB_API = "https://blob.vercel-storage.com";

async function blobPut(pathname, body, token) {
  const res = await fetch(`${BLOB_API}/${pathname}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-content-type": "application/json",
      "x-add-random-suffix": "0",
      "x-cache-control-max-age": "0",
      "x-access": "private",
    },
    body,
  });
  if (!res.ok) throw new Error(`Blob PUT failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function blobExists(pathname, token) {
  const res = await fetch(`${BLOB_API}/${pathname}`, {
    method: "HEAD",
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

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
  try { return await run(req, res); }
  catch (e) { return res.status(500).json({ error: e.message, stack: e.stack }); }
};

async function run(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return res.status(500).json({ error: "BLOB_READ_WRITE_TOKEN not set" });

  const today = new Date().toISOString().split("T")[0];
  const pathname = `leaderboard/${today}.json`;

  if (await blobExists(pathname, token)) {
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

  await blobPut(pathname, JSON.stringify(data, null, 2), token);

  return res.status(200).json({
    success: true,
    date: today,
    rising: data.rising.length,
    paid: data.paid.length,
    ...(errors.length && { errors }),
  });
};
