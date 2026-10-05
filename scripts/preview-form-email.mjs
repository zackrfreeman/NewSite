#!/usr/bin/env node
// Renders a form notification email from a fake payload so the layout can be
// eyeballed in a browser without submitting a real form.
//
//   node scripts/preview-form-email.mjs "Contact Form"
//   node scripts/preview-form-email.mjs "Contact Form" --out preview-contact.html
//
// The renderer is the same module the Netlify function uses, so what you see
// here is what gets sent. Output is gitignored.

import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const config = require(resolve(repoRoot, "netlify/form-notify.config.js"));
const { renderEmail } = require(resolve(repoRoot, "netlify/form-email.js"));
const { buildVcard, buildPdf, buildAutoReply, buildFileLinks, buildCalendarLink, loadLogo } = require(resolve(repoRoot, "netlify/form-extras.js"));

const DEFAULT_OUT = "form-email-preview.html";

// Tracking fields every form gets, plus the two payload keys that must never
// show up in the email body.
const envelope = {
    "form-name": "",
    "bot-field": "",
    ip: "198.51.100.24",
    user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15",
    referrer: "https://www.google.com/",
    source_page: "/",
    referrer_host: "google.com",
    utm_source: "google",
    utm_campaign: "",
};

const fixtures = {
    // Matches the demo form in src/content/pages/contact.html. Add one fixture
    // per form when a site adds forms.
    "Contact Form": {
        form_name: "Contact Form",
        created_at: "2026-10-05T14:20:00.000Z",
        site_url: config.brand.siteUrl,
        data: {
            ...envelope,
            "form-name": "Contact Form",
            source_page: "/contact/",
            name: "Jenna Kowalski",
            email: "jenna.k@example.com",
            phone: "(989) 555-0182",
            "find-us": "Google",
            Message:
                "Do you have openings next week?\n" +
                "Also, what are your hours on Saturdays?",
        },
    },
};

function usage() {
    console.error("Usage: node scripts/preview-form-email.mjs <form-name> [--out <file>]");
    console.error("\nKnown forms:");
    for (const name of Object.keys(fixtures)) console.error(`  ${name}`);
    console.error("\nAny other name renders the generic unknown-form layout.");
}

const argv = process.argv.slice(2);
const outIndex = argv.findIndex((a) => a === "--out" || a === "-o");
const hasOut = outIndex !== -1;
const outFile = hasOut ? argv[outIndex + 1] : DEFAULT_OUT;
// Drop the flag and its value, if present, then take the first positional.
const formName = argv.filter((_, i) => !hasOut || (i !== outIndex && i !== outIndex + 1))[0];

if (!formName || !outFile) {
    usage();
    process.exit(1);
}

const payload = fixtures[formName] || unknownFormFixture(formName);
const logo = config.brand.logo ? loadLogo(config) : null;
const logoSrc = logo ? `data:image/png;base64,${logo.base64}` : undefined;
// Button links need a signing key; the preview uses a throwaway one.
process.env.FORM_LINK_SECRET = process.env.FORM_LINK_SECRET || "preview-only";
const fileLinks = buildFileLinks(payload, config, config.brand.siteUrl);
const calendarLink = fileLinks.calendar || buildCalendarLink(payload, config);
if (calendarLink) console.log(`Calendar: ${calendarLink.href.slice(0, 90)}…`);
const email = renderEmail(payload, config, { logoSrc, fileLinks, calendarLink });
const target = resolve(repoRoot, outFile);
writeFileSync(target, email.html, "utf8");

console.log(`Form:     ${formName}${fixtures[formName] ? "" : "  (no fixture — generic layout)"}`);
console.log(`Subject:  ${email.subject}`);
console.log(`Reply-to: ${email.replyTo || "(none — no valid email field)"}`);
console.log(`HTML:     ${target}`);

// Extras, written next to the HTML with the same base name.
const base = target.replace(/\.html?$/i, "");
const spec = config.forms[payload.form_name];
const card = buildVcard(payload, spec, config.brand);
if (card) {
    writeFileSync(`${base}.vcf`, Buffer.from(card.content, "base64"));
    console.log(`Card:     ${base}.vcf  (attached as "${card.name}")`);
}
const pdf = await buildPdf(payload, config);
if (pdf) {
    writeFileSync(`${base}.pdf`, Buffer.from(pdf.content, "base64"));
    console.log(`PDF:      ${base}.pdf  (attached as "${pdf.name}")`);
}
const reply = buildAutoReply(payload, config, { logoSrc });
if (reply) {
    writeFileSync(`${base}-autoreply.html`, reply.html, "utf8");
    console.log(`Auto-reply to ${reply.to}: "${reply.subject}"  ${base}-autoreply.html`);
}
console.log("");
console.log("--- text version ---");
console.log(email.text);

// Exercises the unknown-form path: ordered_human_fields, no config entry.
function unknownFormFixture(name) {
    return {
        form_name: name,
        created_at: "2026-09-28T12:20:00.000Z",
        site_url: config.brand.siteUrl,
        ordered_human_fields: [
            { title: "Your name", name: "name", value: "Dana Whitmore" },
            { title: "Email", name: "email", value: "dana@whitmorehvac.com" },
            { title: "What do you need?", name: "details", value: "Line one\nLine two" },
        ],
        data: {
            ...envelope,
            "form-name": name,
            name: "Dana Whitmore",
            email: "dana@whitmorehvac.com",
            details: "Line one\nLine two",
        },
    };
}
