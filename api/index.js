const { list } = require("@vercel/blob");

module.exports = async function handler(req, res) {
  const { blobs } = await list({ prefix: "leaderboard/" });

  const entries = blobs
    .filter(b => /\d{4}-\d{2}-\d{2}\.json$/.test(b.pathname))
    .map(b => ({
      date: b.pathname.match(/(\d{4}-\d{2}-\d{2})/)[1],
      url: b.url,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
  res.status(200).json(entries);
};
