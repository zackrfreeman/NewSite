"use strict";

// Netlify event-triggered function: fires after a form submission is stored.
// Sends a formatted notification through ZeptoMail.
//
// Netlify's own built-in form notification is NOT a fallback: it fires on every
// submission regardless of this function, so both on means duplicate emails. It
// stays on during rollout only, then gets switched off. After that a failed send
// means no email, though the submission is still in the Netlify Forms dashboard.
// Either way this function must never throw and never return non-200 — Netlify
// retries non-2xx, and a retry would double-send.
//
// Env vars:
//   ZEPTOMAIL_TOKEN       required. Send-mail token, with or without the
//                         "Zoho-enczapikey " prefix.
//   FORM_NOTIFY_TO        comma-separated recipients. Falls back to client.email.
//   FORM_NOTIFY_FROM      defaults to forms@notify.tricitytech.net
//   FORM_NOTIFY_FROM_NAME defaults to "<client name> Website"

const baseConfig = require("../form-notify.config.js");
const { renderEmail } = require("../form-email.js");
const {
    buildVcard,
    buildPdf,
    buildAutoReply,
    buildFileLinks,
    buildCalendarLink,
    linkBaseFor,
    loadLogo,
    withoutLogo,
} = require("../form-extras.js");
const client = require("../../src/_data/client.js");

const ZEPTOMAIL_ENDPOINT = "https://api.zeptomail.com/v1.1/email";
const TOKEN_PREFIX = "Zoho-enczapikey";
const SEND_TIMEOUT_MS = 10000;

const DEFAULT_FROM = "forms@notify.tricitytech.net";

// Always 200: Netlify retries non-2xx, and a retry would double-send.
const OK = (detail) => ({
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, ...detail }),
});

exports.handler = async (event) => {
    try {
        const payload = parsePayload(event);
        if (!payload) {
            console.error("[form-notify] no submission payload on event body; nothing to send");
            return OK({ sent: false, reason: "no-payload" });
        }

        // Logo is optional: with brand.logo set, the PNG rides along as an inline
        // image. If the file can't be read, fall back to the text header.
        const logo = baseConfig.brand.logo ? loadLogo(baseConfig) : null;
        const config = baseConfig.brand.logo && !logo ? withoutLogo(baseConfig) : baseConfig;
        const inlineImages = logo
            ? [{ cid: logo.cid, mime_type: "image/png", name: "logo.png", content: logo.base64 }]
            : null;

        // Button links point back at the site the form was submitted on, so they
        // work on branch previews too (Netlify doesn't give functions the
        // preview's URL). See linkBaseFor in form-extras.js.
        const linkBase = linkBaseFor(payload, config);
        const fileLinks = buildFileLinks(payload, config, linkBase);

        // Signed chooser page (Google or other calendar) when links can be
        // signed; otherwise a direct Google Calendar link.
        const calendarLink = fileLinks.calendar || buildCalendarLink(payload, config);

        const email = renderEmail(payload, config, { fileLinks, calendarLink });
        if (!email.isKnownForm) {
            console.warn(
                `[form-notify] form "${email.formName}" is not in form-notify.config.js; using the generic layout`
            );
        }

        const token = readToken();
        if (!token) {
            console.error(
                "[form-notify] ZEPTOMAIL_TOKEN is not set; skipping send. No email will go out unless Netlify's own form notification is still switched on."
            );
            return OK({ sent: false, reason: "missing-token" });
        }

        const to = readRecipients();
        if (!to.length) {
            console.error("[form-notify] no recipients: FORM_NOTIFY_TO is empty and client.email is unset");
            return OK({ sent: false, reason: "no-recipients" });
        }

        // Attachments are best-effort: each builder returns null on any problem,
        // and the notification goes out with whatever did build.
        const spec = config.forms && config.forms[email.formName];
        const attachments = [buildVcard(payload, spec, config.brand), await buildPdf(payload, config)].filter(Boolean);

        const sent = await send({
            token,
            label: `notification "${email.subject}"`,
            body: {
                from: {
                    address: fromAddress(),
                    name: String(process.env.FORM_NOTIFY_FROM_NAME || `${client.name} Website`).trim(),
                },
                to: to.map((address) => ({ email_address: { address } })),
                subject: email.subject,
                htmlbody: email.html,
                textbody: email.text,
                ...(email.replyTo ? { reply_to: [{ address: email.replyTo }] } : {}),
                ...(attachments.length ? { attachments } : {}),
                ...(inlineImages ? { inline_images: inlineImages } : {}),
            },
        });

        // The "got it" email to the submitter. Sent after, and independent of,
        // the owner's notification: a failure here never costs the lead.
        let autoReplied = false;
        const reply = buildAutoReply(payload, config);
        if (reply) {
            autoReplied = await send({
                token,
                label: `auto-reply "${reply.subject}"`,
                body: {
                    from: {
                        address: fromAddress(),
                        name: String(config.brand.autoReplyFromName || client.name).trim(),
                    },
                    to: [{ email_address: { address: reply.to } }],
                    subject: reply.subject,
                    htmlbody: reply.html,
                    textbody: reply.text,
                    reply_to: [{ address: config.brand.replyTo || client.email }],
                    ...(inlineImages ? { inline_images: inlineImages } : {}),
                },
            });
        }

        return OK({
            sent,
            autoReplied,
            attachments: attachments.map((a) => a.name),
            form: email.formName,
            ...(sent ? {} : { reason: "send-failed" }),
        });
    } catch (error) {
        // Belt and braces: nothing above should throw, but a 500 here would make
        // Netlify retry and duplicate the notification.
        console.error("[form-notify] unexpected failure:", error && error.stack ? error.stack : error);
        return OK({ sent: false, reason: "error" });
    }
};

function parsePayload(event) {
    if (!event || typeof event.body !== "string" || event.body === "") return null;
    let parsed;
    try {
        parsed = JSON.parse(event.body);
    } catch (error) {
        console.error("[form-notify] event body was not JSON:", error.message);
        return null;
    }
    const payload = parsed && parsed.payload;
    if (!payload || typeof payload !== "object") return null;
    return payload;
}

// The Zoho dashboard shows the token both bare and with the header prefix
// already on it. Accept either so a paste from the dashboard just works.
function readToken() {
    const raw = String(process.env.ZEPTOMAIL_TOKEN || "").trim();
    if (!raw) return "";
    const stripped = raw.replace(new RegExp(`^${TOKEN_PREFIX}\\s+`, "i"), "").trim();
    return stripped;
}

function readRecipients() {
    const raw = String(process.env.FORM_NOTIFY_TO || "").trim();
    const list = raw
        ? raw.split(",").map((address) => address.trim()).filter(Boolean)
        : [];
    if (list.length) return list;
    // Better to land in the owner's inbox than to drop the lead on the floor.
    const fallback = String(client.email || "").trim();
    if (fallback) {
        console.warn(`[form-notify] FORM_NOTIFY_TO is not set; falling back to ${fallback}`);
        return [fallback];
    }
    return [];
}

function fromAddress() {
    return String(process.env.FORM_NOTIFY_FROM || baseConfig.brand.fromAddress || DEFAULT_FROM).trim();
}

// Resolves true only when ZeptoMail accepted the message. Never rejects:
// every failure path logs and resolves false so the handler can still return 200.
async function send({ token, label, body }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

    let response;
    try {
        response = await fetch(ZEPTOMAIL_ENDPOINT, {
            method: "POST",
            headers: {
                accept: "application/json",
                "content-type": "application/json",
                authorization: `${TOKEN_PREFIX} ${token}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (error) {
        const reason = error && error.name === "AbortError" ? `timed out after ${SEND_TIMEOUT_MS}ms` : error.message;
        console.error(`[form-notify] ${label}: ZeptoMail request failed (${reason}). Not sent; the submission is still in the Netlify Forms dashboard.`);
        return false;
    } finally {
        clearTimeout(timer);
    }

    const raw = await response.text().catch(() => "");
    if (!response.ok) {
        console.error(
            `[form-notify] ${label}: ZeptoMail rejected the send: HTTP ${response.status} ${describeZeptoError(raw)}. Not sent; the submission is still in the Netlify Forms dashboard.`
        );
        return false;
    }

    const recipients = body.to.map((t) => t.email_address.address).join(", ");
    const attached = body.attachments ? ` with ${body.attachments.map((a) => a.name).join(", ")}` : "";
    console.log(`[form-notify] sent ${label} to ${recipients}${attached}`);
    return true;
}

// ZeptoMail errors look like { error: { code, message, details:[{code,message,target}] } }
function describeZeptoError(raw) {
    try {
        const parsed = JSON.parse(raw);
        const error = parsed && parsed.error;
        if (!error) return raw.slice(0, 300);
        const codes = [error.code, ...(Array.isArray(error.details) ? error.details.map((d) => d && d.code) : [])]
            .filter(Boolean)
            .join(", ");
        const targets = (Array.isArray(error.details) ? error.details : [])
            .map((d) => d && d.target)
            .filter(Boolean)
            .join(", ");
        return [
            codes ? `code=${codes}` : "",
            error.message ? `message=${error.message}` : "",
            targets ? `target=${targets}` : "",
        ]
            .filter(Boolean)
            .join(" ");
    } catch (_) {
        return raw.slice(0, 300);
    }
}
