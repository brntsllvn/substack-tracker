const BLOB_API = "https://blob.vercel-storage.com";

module.exports = async function handler(req, res) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return res.status(500).json({ error: "BLOB_READ_WRITE_TOKEN not set" });

  try {
    const listRes = await fetch(`${BLOB_API}?prefix=${encodeURIComponent("leaderboard/")}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!listRes.ok) throw new Error(`Blob list failed: ${listRes.status}`);

    const { blobs } = await listRes.json();
    const dayBlobs = (blobs || [])
      .filter(b => /\d{4}-\d{2}-\d{2}/.test(b.pathname))
      .sort((a, b) => a.pathname.localeCompare(b.pathname));

    const days = await Promise.all(
      dayBlobs.map(b =>
        fetch(b.url, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json())
      )
    );

    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    res.status(200).json(days);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
