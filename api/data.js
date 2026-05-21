const { list, download } = require("@vercel/blob");

module.exports = async function handler(req, res) {
  try {
    const { blobs } = await list({ prefix: "leaderboard/" });
    const dayBlobs = blobs
      .filter(b => /\d{4}-\d{2}-\d{2}/.test(b.pathname))
      .sort((a, b) => a.pathname.localeCompare(b.pathname));

    const days = await Promise.all(
      dayBlobs.map(async b => {
        const r = await download(b.url);
        return r.json();
      })
    );

    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    res.status(200).json(days);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
