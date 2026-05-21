const BLOB_API = "https://blob.vercel-storage.com";

module.exports = async function handler(req, res) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const r = await fetch(`${BLOB_API}?prefix=leaderboard%2F&token=${token}`);
  if (!r.ok) return res.status(500).json({ error: "Blob list failed" });

  const { blobs } = await r.json();
  const entries = (blobs || [])
    .filter(b => /\d{4}-\d{2}-\d{2}\.json$/.test(b.pathname))
    .map(b => ({ date: b.pathname.match(/(\d{4}-\d{2}-\d{2})/)[1], url: b.url }))
    .sort((a, b) => a.date.localeCompare(b.date));

  res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
  res.status(200).json(entries);
};
