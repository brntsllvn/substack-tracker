const { list } = require("@vercel/blob");

module.exports = async function handler(req, res) {
  try {
    const { blobs } = await list({ prefix: "leaderboard/" });
    const entries = blobs
      .filter(b => /\d{4}-\d{2}-\d{2}/.test(b.pathname))
      .sort((a, b) => a.pathname.localeCompare(b.pathname))
      .map(b => ({ date: b.pathname.match(/(\d{4}-\d{2}-\d{2})/)[1], url: b.url }));

    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    res.status(200).json(entries);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
