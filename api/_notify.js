const ts = () => new Date().toISOString();
const log = (...a) => console.log(`[${ts()}]`, ...a);
const err = (...a) => console.error(`[${ts()}]`, ...a);

async function sendAlert(subject, lines) {
  const apiKey = process.env.RESEND_API_KEY;
  const to     = process.env.ALERT_EMAIL;

  if (!apiKey || !to) {
    log("notify: RESEND_API_KEY or ALERT_EMAIL not set — skipping email alert");
    return;
  }

  const body = [
    subject,
    "=".repeat(subject.length),
    "",
    ...lines,
    "",
    "---",
    `Fix: curl -X POST https://substack-tracker-bay.vercel.app/api/scrape`,
    `Time: ${ts()}`,
  ].join("\n");

  log(`notify: sending alert to ${to}: "${subject}"`);

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Substack Tracker <alerts@taxalphainsider.com>",
        to: [to],
        subject: `[substack-tracker] ${subject}`,
        text: body,
      }),
    });
    const result = await r.json();
    if (r.ok) {
      log(`notify: email sent, id=${result.id}`);
    } else {
      err(`notify: Resend returned ${r.status}: ${JSON.stringify(result)}`);
    }
  } catch (e) {
    err(`notify: email send failed: ${e.message}`);
  }
}

module.exports = { sendAlert };
