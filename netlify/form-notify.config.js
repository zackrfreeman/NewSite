"use strict";

// Per-form email layout for netlify/functions/submission-created.js.
// Lives outside netlify/functions/ on purpose: it is a plain require, not a
// second function. esbuild bundles it (and client.js) into the function.
//
// The renderer (form-email.js) and extras (form-extras.js) are shared across
// every TCT site (NewSite, TCTech2, EliteExpressWash, ...). Keep those two
// files identical across repos and put everything site-specific HERE.
//
// NEW SITE SETUP (search this file for TODO):
//   1. Set netlifySite, color, tint, and fromAddress below.
//   2. Logo (optional): drop a PNG at netlify/assets/email-logo.png, saved at
//      exactly 2x the display size, and fill in brand.logo. Leave it null for
//      a text header. Gmail does not render SVG, so the site's SVG logo won't work.
//   3. Make every form in the HTML match a spec in `forms` (name and field names).
//   4. Have the client approve the auto-reply wording before launch.
//   5. Netlify env vars: ZEPTOMAIL_TOKEN (required), FORM_NOTIFY_TO, and
//      optionally FORM_LINK_SECRET. See the header of submission-created.js.
//   6. Preview: node scripts/preview-form-email.mjs "Contact Form"
//   7. After a live test, turn off Netlify's built-in form notification email,
//      or every submission sends two notifications.

const client = require("../src/_data/client.js");

const brand = {
    name: client.name,
    siteUrl: client.domain,
    // TODO: Netlify site name (the xxx in xxx.netlify.app). Lets button links
    // in the email point at branch previews.
    netlifySite: "",
    // TODO: --primary from src/assets/less/root.less (kept in sync by hand).
    // Buttons, links, section titles.
    color: "#1F487E",
    // TODO: light tint of the primary color, for the highlight tiles.
    tint: "#eef3fb",
    // Logo in the email header and lead-sheet PDF, embedded inline (cid:logo)
    // so it shows without the site being live. Example:
    //   logo: { cid: "logo", path: "netlify/assets/email-logo.png", width: 240, height: 142 },
    // If logo is set, also add `included_files = ["netlify/assets/**"]` under
    // [functions] in netlify.toml so the PNG ships with the function.
    logo: null,
    logoIsPlaceholder: false,
    sentBy: "Built and maintained by TriCity Technologies",
    // TODO: sender address. Use the client's own domain, verified in
    // ZeptoMail, or the send is rejected. Sending as tricitytech.net for a
    // client got quarantined as phishing by Microsoft 365 (name/domain
    // mismatch), 2026-09-29. Empty = FORM_NOTIFY_FROM env var, then
    // forms@notify.tricitytech.net.
    fromAddress: "",
    // Auto-replies: sent as the business, and replies go to the business inbox.
    autoReplyFromName: client.name,
    replyTo: client.email,
    signature: [client.name, `Call or text ${client.phoneFormatted}`],
};

// Never shown in the body of any email, for any form.
const alwaysHidden = ["form-name", "bot-field", "ip", "user_agent", "referrer"];

// Footer labels for tracking fields. Any form can list these in `meta`.
const metaLabels = {
    referrer: "Page",
    source_page: "Page",
    referrer_host: "Referrer",
    utm_source: "UTM source",
    utm_campaign: "UTM campaign",
};

// One entry per form, keyed by the form's `name` attribute. A form not listed
// here still sends, with a generic layout (and a warning in the function log).
// Elite's fleet-inquiry spec (EliteExpressWash repo) shows every option: hero,
// replyWithinHours, followUp calendar link, PDF lead sheet.
const forms = {
    // Matches the demo form in src/content/pages/contact.html.
    "Contact Form": {
        label: "website message",
        subject: (d) => `New website message — ${firstNonEmpty(d.name, "someone")}`,
        replySubject: () => `Re: your message to ${client.name}`,
        replyToField: "email",
        nameField: "name",
        phoneField: "phone",
        // One-tap buttons in the notification, first one filled.
        actions: ["call", "text", "email"],
        sections: [
            {
                fields: [
                    { name: "name", label: "Name" },
                    { name: "phone", label: "Phone", link: "tel" },
                    { name: "email", label: "Email", link: "email" },
                    { name: "find-us", label: "How they found us" },
                    // Capital M: the field is named "Message" in contact.html.
                    { name: "Message", label: "Message", long: true },
                ],
            },
        ],
        // Netlify's "referrer" is the page the form was submitted on.
        meta: ["referrer"],
        vcard: { name: "name", email: "email", phone: "phone" },
        // TODO: client approves this wording before launch. Never add
        // submitted text beyond {greeting}; see form-extras.js.
        autoReply: {
            subject: `We got your message | ${client.name}`,
            paragraphs: [
                `Thanks for reaching out to ${client.name}. We got your message and we'll get back to you soon.`,
                `For anything urgent, call or text us at ${client.phoneFormatted}.`,
            ],
            footer: "You're getting this because you sent a message on {site}.",
        },
    },
};

function firstNonEmpty(...values) {
    for (const v of values) {
        if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
    }
    return "";
}

module.exports = { brand, forms, alwaysHidden, metaLabels };
