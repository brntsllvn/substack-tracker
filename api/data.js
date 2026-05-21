const BLOB_API = "https://blob.vercel-storage.com";

async function blobList(token) {
  const r = await fetch(`${BLOB_API}?prefix=leaderboard%2F`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Blob list failed: ${r.status}`);
  const { blobs } = await r.json();
  return (blobs || []).filter(b => /\d{4}-\d{2}-\d{2}\.json$/.test(b.pathname));
}

async function blobGet(url, token) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Blob GET failed: ${r.status}`);
  return r.json();
}

module.exports = async function handler(req, res) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return res.status(500).json({ error: "BLOB_READ_WRITE_TOKEN not set" });

  try {
    const blobs = await blobList(token);
    blobs.sort((a, b) => a.pathname.localeCompare(b.pathname));

    const days = await Promise.all(blobs.map(b => blobGet(b.url, token)));

    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    res.status(200).json(days);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
