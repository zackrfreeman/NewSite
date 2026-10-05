"use strict";

// Serves the "Save contact" and "Lead sheet (PDF)" buttons in form
// notification emails. The link itself carries the lead's fields, signed by
// submission-created.js (see buildFileLinks in form-extras.js), so this
// function stores nothing and looks nothing up: it checks the signature and
// rebuilds the same .vcf or .pdf that was attached to the email.
//
//   GET /.netlify/functions/lead-file?t=vcf|pdf|cal|ics&p=<packed>&s=<signature>
//
//   cal: a small page with "Google Calendar" and "Apple / Outlook / other"
//        buttons for the follow-up reminder (email can't do a dropdown).
//   ics: the calendar file behind the second button.

const baseConfig = require("../form-notify.config.js");
const {
    buildVcard,
    buildPdf,
    readFileLink,
    loadLogo,
    withoutLogo,
    followUpEvent,
    googleCalendarHref,
    buildIcs,
} = require("../form-extras.js");
const { escapeHtml } = require("../form-email.js");

const NOT_FOUND = {
    statusCode: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    body: "This link is invalid or has expired. The file is still attached to the original email.",
};

exports.handler = async (event) => {
    try {
        if (event && event.httpMethod && event.httpMethod !== "GET" && event.httpMethod !== "HEAD") {
            return { statusCode: 405, headers: { allow: "GET" }, body: "" };
        }
        const q = (event && event.queryStringParameters) || {};
        const type = String(q.t || "");
        if (!["vcf", "pdf", "cal", "ics"].includes(type)) return NOT_FOUND;

        const payload = readFileLink(q.p, q.s);
        if (!payload) return NOT_FOUND;

        const logo = baseConfig.brand.logo ? loadLogo(baseConfig) : null;
        const config = baseConfig.brand.logo && !logo ? withoutLogo(baseConfig) : baseConfig;
        const spec = config.forms && config.forms[payload.form_name];
        if (!spec) return NOT_FOUND;

        if (type === "cal" || type === "ics") {
            const calEvent = followUpEvent(payload, config);
            if (!calEvent) return NOT_FOUND;
            if (type === "cal") {
                const icsHref = `?t=ics&p=${encodeURIComponent(q.p)}&s=${encodeURIComponent(q.s)}`;
                return {
                    statusCode: 200,
                    headers: {
                        "content-type": "text/html; charset=utf-8",
                        "cache-control": "private, no-store",
                        "x-robots-tag": "noindex, nofollow",
                        "referrer-policy": "no-referrer",
                    },
                    body: chooserPage(calEvent, googleCalendarHref(calEvent), icsHref, config.brand, logo),
                };
            }
            const text = buildIcs(calEvent, config);
            const name = `${calEvent.title.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 70)}.ics`;
            return {
                statusCode: 200,
                headers: {
                    "content-type": "text/calendar; charset=utf-8",
                    "content-disposition": `inline; filename="${name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"`,
                    "cache-control": "private, no-store",
                    "x-robots-tag": "noindex, nofollow",
                },
                body: Buffer.from(text, "utf8").toString("base64"),
                isBase64Encoded: true,
            };
        }

        const file = type === "vcf" ? buildVcard(payload, spec, config.brand) : await buildPdf(payload, config);
        if (!file) return NOT_FOUND;

        // Plain-ASCII fallback filename plus the UTF-8 one for browsers that read it.
        const ascii = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
        return {
            statusCode: 200,
            headers: {
                "content-type": type === "vcf" ? "text/vcard; charset=utf-8" : "application/pdf",
                // inline: phones open the card in Contacts and the PDF in the viewer.
                "content-disposition": `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
                "cache-control": "private, no-store",
                "x-robots-tag": "noindex, nofollow",
                "referrer-policy": "no-referrer",
            },
            body: file.content,
            isBase64Encoded: true,
        };
    } catch (error) {
        console.error("[lead-file] failed:", error && error.stack ? error.stack : error);
        return NOT_FOUND;
    }
};

// The calendar chooser: the event, then one button per calendar type.
function chooserPage(event, googleHref, icsHref, brand, logo) {
    const color = brand.color || "#1F487E";
    const logoTag = logo
        ? `<img src="data:image/png;base64,${logo.base64}" alt="${escapeHtml(brand.name)}" width="${
              (brand.logo && brand.logo.width) || 160
          }" style="display:block;margin:0 auto 20px;max-width:60%;height:auto;">`
        : `<p class="brand">${escapeHtml(brand.name)}</p>`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Add follow-up reminder</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#f4f5f7;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#212529}
  main{max-width:440px;margin:0 auto;padding:32px 16px}
  .card{background:#fff;border-radius:12px;padding:28px 22px;border-top:4px solid ${color}}
  .brand{margin:0 0 16px;text-align:center;font-weight:700;color:${color}}
  .kicker{margin:0;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${color}}
  h1{margin:6px 0 4px;font-size:21px;line-height:1.3}
  .when{margin:0 0 24px;color:#6c757d}
  a.btn{display:block;margin:0 0 12px;padding:15px 16px;border-radius:8px;text-align:center;font-weight:700;text-decoration:none;border:2px solid ${color}}
  a.primary{background:${color};color:#fff}
  a.secondary{background:#fff;color:${color}}
  .hint{margin:6px 0 0;font-size:13px;color:#6c757d;text-align:center}
</style>
</head>
<body>
<main>
  <div class="card">
    ${logoTag}
    <p class="kicker">Follow-up reminder</p>
    <h1>${escapeHtml(event.title)}</h1>
    <p class="when">${escapeHtml(event.whenText)}, 15 minutes</p>
    <a class="btn primary" href="${escapeHtml(googleHref)}">Google Calendar</a>
    <a class="btn secondary" href="${escapeHtml(icsHref)}">Apple, Outlook, or other calendar</a>
    <p class="hint">The second button downloads a calendar file. Open it to add the reminder.</p>
  </div>
</main>
</body>
</html>`;
}
