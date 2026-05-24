const { sendAlert } = require("./_notify");

const OWNER = "brntsllvn";
const REPO = "substack-tracker";
const GH = "https://api.github.com";

const ts  = () => new Date().toISOString();
const log  = (...a) => console.log( `[${ts()}]`, ...a);
const warn = (...a) => console.warn( `[${ts()}]`, ...a);
const err  = (...a) => console.error(`[${ts()}]`, ...a);

module.exports = async function handler(req, res) {
  const t0 = Date.now();
  log(`--- check invoked method=${req.method}`);
  log(`env: GITHUB_PAT=${process.env.GITHUB_PAT ? `set (${process.env.GITHUB_PAT.length} chars)` : "MISSING"} VERCEL_URL=${process.env.VERCEL_URL || "(not set)"}`);

  const pat = process.env.GITHUB_PAT;
  if (!pat) {
    err("GITHUB_PAT not set, cannot check GitHub");
    return res.status(500).json({ error: "GITHUB_PAT not set" });
  }

  const today = new Date().toISOString().split("T")[0];
  const dataPath = `data/${today}.json`;
  log(`today=${today}, checking ${dataPath} in GitHub`);

  try {
    const r = await fetch(`${GH}/repos/${OWNER}/${REPO}/contents/${dataPath}`, {
      headers: { Authorization: `token ${pat}`, Accept: "application/vnd.github.v3+json" },
    });
    log(`GitHub check -> HTTP ${r.status}`);

    if (r.status === 200) {
      log(`${dataPath} EXISTS: data is current, no action needed (${Date.now() - t0}ms)`);
      return res.status(200).json({ ok: true, date: today, status: "data_present" });
    }

    if (r.status !== 404) {
      const body = await r.text();
      throw new Error(`Unexpected GitHub response ${r.status}: ${body.slice(0, 200)}`);
    }
  } catch (e) {
    err(`GitHub check failed: ${e.message}`);
    return res.status(500).json({ error: `GitHub check failed: ${e.message}`, date: today });
  }

  warn(`${dataPath} is MISSING, triggering emergency scrape`);

  // VERCEL_URL is set automatically to the current deployment's host (no protocol).
  // Fall back to the stable production alias if missing.
  const host = process.env.VERCEL_URL || "substack-tracker-bay.vercel.app";
  const scrapeUrl = `https://${host}/api/scrape`;
  log(`Calling scrape endpoint: ${scrapeUrl}`);

  const cronSecret = process.env.CRON_SECRET;
  const scrapeHeaders = cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {};

  let scrapeResult, scrapeStatus;
  try {
    const sr = await fetch(scrapeUrl, { headers: scrapeHeaders });
    scrapeStatus = sr.status;
    scrapeResult = await sr.json();
    log(`Scrape response: HTTP ${scrapeStatus}: ${JSON.stringify(scrapeResult)}`);
  } catch (e) {
    err(`Scrape call failed: ${e.message}`);
    return res.status(500).json({
      error: `Scrape call failed: ${e.message}`,
      date: today,
      status: "scrape_call_failed",
    });
  }

  const elapsed = Date.now() - t0;
  if (scrapeStatus === 200 && scrapeResult.success) {
    log(`--- check DONE: emergency scrape succeeded in ${elapsed}ms`);
    return res.status(200).json({ ok: true, date: today, status: "scraped_by_checker", scrape: scrapeResult, elapsed_ms: elapsed });
  }

  err(`--- check DONE: emergency scrape FAILED after ${elapsed}ms: ${JSON.stringify(scrapeResult)}`);
  await sendAlert(`Checker FAILED: no data for ${today} after emergency scrape`, [
    "The 06:00 UTC scrape missed AND the 14:00 UTC emergency scrape also failed.",
    `Data for ${today} is missing.`,
    "",
    `Scrape response (HTTP ${scrapeStatus}):`,
    JSON.stringify(scrapeResult, null, 2),
  ]);
  return res.status(500).json({ ok: false, date: today, status: "scrape_failed", scrape: scrapeResult, elapsed_ms: elapsed });
};
