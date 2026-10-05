"use strict";

// Shared renderer for Netlify form notification emails.
// Used by netlify/functions/submission-created.js and by
// scripts/preview-form-email.mjs, so the preview is the real thing.
// No dependencies: everything here is stdlib.

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const INK = "#212529";
const MUTED = "#6c757d";
const RULE = "#e9ecef";
const HAIRLINE = "#f1f3f5";
const PAGE_BG = "#f4f5f7";
const BLOCK_BG = "#f8f9fa";

/* ---------------------------------------------------------------- helpers */

function escapeHtml(value) {
    return String(value === undefined || value === null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function nl2br(escaped) {
    return escaped.replace(/\r\n|\r|\n/g, "<br />");
}

function isBlank(value) {
    return value === undefined || value === null || String(value).trim() === "";
}

function clean(value) {
    return String(value === undefined || value === null ? "" : value).trim();
}

function firstWord(value) {
    const parts = clean(value).split(/\s+/);
    return parts[0] || "";
}

function isEmail(value) {
    return EMAIL_RE.test(clean(value));
}

// US numbers (10 digits, or 11 starting with 1) as "(989) 326-4894".
// Anything else is left exactly as typed.
function usDigits(value) {
    const digits = clean(value).replace(/[^\d]/g, "");
    if (digits.length === 10) return digits;
    if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
    return "";
}

function formatPhone(value) {
    const us = usDigits(value);
    return us ? `(${us.slice(0, 3)}) ${us.slice(3, 6)}-${us.slice(6)}` : clean(value);
}

// tel: in E.164 for US numbers; otherwise digits, keeping a leading +.
function telHref(value) {
    const us = usDigits(value);
    if (us) return `+1${us}`;
    const raw = clean(value);
    const digits = raw.replace(/[^\d]/g, "");
    if (!digits) return "";
    return (raw.trim().startsWith("+") ? "+" : "") + digits;
}

function urlHref(value) {
    const raw = clean(value);
    if (!raw) return "";
    return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function mailtoHref(address, subject) {
    const base = `mailto:${clean(address)}`;
    return subject ? `${base}?subject=${encodeURIComponent(subject)}` : base;
}

// "Mon Sep 28, 8:20 AM" in America/Detroit.
function formatSubmittedAt(isoish) {
    const date = isoish ? new Date(isoish) : new Date();
    if (Number.isNaN(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Detroit",
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    })
        .formatToParts(date)
        .reduce((acc, part) => {
            acc[part.type] = part.value;
            return acc;
        }, {});
    return `${parts.weekday} ${parts.month} ${parts.day}, ${parts.hour}:${parts.minute} ${parts.dayPeriod}`;
}

/* ------------------------------------------------------------------ model */

// Turns a payload into a layout-agnostic model, so the HTML and text renderers
// stay in step.
function buildModel(payload, config) {
    const { brand, forms, alwaysHidden, metaLabels } = config;
    const data = (payload && payload.data) || {};
    const formName = clean(payload && payload.form_name) || "form";
    const form = (forms && forms[formName]) || null;

    const spec = form || genericSpec(payload, alwaysHidden);
    const label = spec.label || formName;

    const sections = [];
    for (const section of spec.sections) {
        const rows = [];
        const blocks = [];
        for (const field of section.fields) {
            const name = typeof field === "string" ? field : field.name;
            if (alwaysHidden.includes(name)) continue;
            const value = data[name];
            if (isBlank(value)) continue;
            const link = (typeof field === "object" && field.link) || null;
            const entry = {
                label: (typeof field === "object" && field.label) || name,
                value: link === "tel" ? formatPhone(value) : clean(value),
                link,
            };
            const isLong =
                (typeof field === "object" && field.long) ||
                /\r|\n/.test(String(value)) ||
                clean(value).length > 140;
            (isLong ? blocks : rows).push(entry);
        }
        if (rows.length || blocks.length) {
            sections.push({ title: section.title || null, rows, blocks });
        }
    }

    // Footer tracking values, with per-field fallbacks (referrer_host -> referrer).
    const meta = [];
    for (const name of spec.meta || []) {
        let value = data[name];
        const fallback = spec.metaFallbacks && spec.metaFallbacks[name];
        if (isBlank(value) && fallback) value = data[fallback];
        if (isBlank(value)) continue;
        meta.push({ label: (metaLabels && metaLabels[name]) || name, value: clean(value), name });
    }

    const replyAddress = spec.replyToField ? clean(data[spec.replyToField]) : "";
    const replyTo = isEmail(replyAddress) ? replyAddress : "";
    const replyName = spec.nameField ? firstWord(data[spec.nameField]) : "";
    const phone = spec.phoneField ? formatPhone(data[spec.phoneField]) : "";

    const subject =
        typeof spec.subject === "function" ? spec.subject(data) : `New ${label}`;
    const replySubject =
        typeof spec.replySubject === "function" ? spec.replySubject(data) : `Re: your ${label}`;

    return {
        brand,
        formName,
        label,
        heading: `New ${label}`,
        subject,
        replyTo,
        replySubject,
        replyName,
        phone,
        sections,
        submittedAt: formatSubmittedAt(payload && payload.created_at),
        meta,
        siteUrl: clean(payload && payload.site_url) || brand.siteUrl,
        hero: buildHero(spec.hero, data),
        replyBy: replyByTime(payload && payload.created_at, spec.replyWithinHours),
        actions: Array.isArray(spec.actions) ? spec.actions : null,
        hasCard: Boolean(spec.vcard),
    };
}

// Optional headline block: a kicker, one big value (e.g. the business name),
// a smaller line under it, and a highlighted figure (e.g. fleet size).
function buildHero(hero, data) {
    if (!hero) return null;
    const title = clean(data[hero.titleField]);
    const subtitle = clean(data[hero.subtitleField]);
    let highlight = null;
    if (hero.highlight) {
        const raw = clean(data[hero.highlight.field]);
        if (raw) {
            const value = typeof hero.highlight.format === "function" ? hero.highlight.format(raw) : raw;
            highlight = { label: hero.highlight.label || hero.highlight.field, value };
        }
    }
    if (!title && !highlight) return null;
    return { kicker: hero.kicker || "", title, subtitle, highlight };
}

// "Reply by" deadline for forms whose site copy promises a response time.
function replyByTime(isoish, hours) {
    if (!hours) return "";
    const start = isoish ? new Date(isoish) : new Date();
    if (Number.isNaN(start.getTime())) return "";
    return formatSubmittedAt(new Date(start.getTime() + hours * 3600 * 1000).toISOString());
}

// Unknown form: every human field Netlify gave us, in the order it gave them.
function genericSpec(payload, alwaysHidden) {
    const ordered = Array.isArray(payload && payload.ordered_human_fields)
        ? payload.ordered_human_fields
        : [];
    const fields = ordered
        .map((f) => ({ name: f && f.name, label: (f && f.title) || (f && f.name) }))
        .filter((f) => f.name && !alwaysHidden.includes(f.name));

    // Nothing ordered to work with: fall back to the raw data keys.
    const fallbackFields = Object.keys((payload && payload.data) || {})
        .filter((name) => !alwaysHidden.includes(name))
        .map((name) => ({ name, label: name }));

    return {
        label: `${clean(payload && payload.form_name) || "form"} submission`,
        subject: () => `New submission — ${clean(payload && payload.form_name) || "website form"}`,
        replyToField: findEmailField(payload),
        nameField: "name",
        phoneField: "phone",
        sections: [{ fields: fields.length ? fields : fallbackFields }],
        meta: ["source_page", "referrer_host", "utm_source", "utm_campaign"],
        metaFallbacks: { referrer_host: "referrer" },
    };
}

function findEmailField(payload) {
    const data = (payload && payload.data) || {};
    if (isEmail(data.email)) return "email";
    for (const [name, value] of Object.entries(data)) {
        if (isEmail(value)) return name;
    }
    return null;
}

/* ------------------------------------------------------------------- HTML */

function renderRows(rows, color) {
    if (!rows.length) return "";
    const cells = rows
        .map((row, index) => {
            const last = index === rows.length - 1;
            const border = last ? "" : `border-bottom:1px solid ${HAIRLINE};`;
            return `            <tr>
              <td style="padding:10px 14px 10px 0;vertical-align:top;font:400 13px/1.5 ${FONT};color:${MUTED};width:38%;${border}">${escapeHtml(row.label)}</td>
              <td style="padding:10px 0;vertical-align:top;font:400 15px/1.5 ${FONT};color:${INK};word-break:break-word;${border}">${renderValue(row, color)}</td>
            </tr>`;
        })
        .join("\n");
    return `          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 4px;">
${cells}
          </table>\n`;
}

function renderValue(row, color) {
    const text = escapeHtml(row.value);
    const linkStyle = `color:${color || "#1F487E"};text-decoration:underline;`;
    if (row.link === "email" && isEmail(row.value)) {
        return `<a href="mailto:${escapeHtml(row.value)}" style="${linkStyle}">${text}</a>`;
    }
    if (row.link === "tel") {
        const href = telHref(row.value);
        if (href) return `<a href="tel:${escapeHtml(href)}" style="${linkStyle}">${text}</a>`;
    }
    if (row.link === "url") {
        const href = urlHref(row.value);
        if (href) return `<a href="${escapeHtml(href)}" style="${linkStyle}">${text}</a>`;
    }
    return text;
}

function renderBlocks(blocks) {
    return blocks
        .map(
            (block) => `          <p style="margin:18px 0 6px;font:400 13px/1.5 ${FONT};color:${MUTED};">${escapeHtml(block.label)}</p>
          <div style="margin:0;padding:14px 16px;background:${BLOCK_BG};border-radius:6px;font:400 15px/1.6 ${FONT};color:${INK};white-space:pre-wrap;word-break:break-word;">${nl2br(escapeHtml(block.value))}</div>\n`
        )
        .join("");
}

function renderSection(section, color) {
    const heading = section.title
        ? `          <p style="margin:28px 0 10px;font:700 13px/1.4 ${FONT};color:${color};text-transform:uppercase;letter-spacing:.04em;">${escapeHtml(
              section.title
          )}</p>\n`
        : "";
    return heading + renderRows(section.rows, color) + renderBlocks(section.blocks);
}

// Logo header: a white band with the logo centred and a brand-colour rule under
// it. The logo travels inside the email as an inline image (cid:), so it shows
// without the site being live and without "load remote images".
function renderLogoHeader(model, color) {
    const logo = model.brand.logo;
    const src = model.logoSrc || `cid:${logo.cid}`;
    return `          <tr>
            <td align="center" style="padding:22px 24px 18px;background:#ffffff;border-bottom:4px solid ${color};">
              <img src="${escapeHtml(src)}" width="${logo.width}" height="${logo.height}" alt="${escapeHtml(
        model.brand.name
    )}" style="display:block;border:0;width:${logo.width}px;max-width:100%;height:auto;" />
            </td>
          </tr>`;
}

function renderHero(model, color) {
    const { hero } = model;
    const tint = model.brand.tint || "#eef3fb";
    const kicker = hero.kicker
        ? `          <p style="margin:0 0 6px;font:700 12px/1.4 ${FONT};color:${color};text-transform:uppercase;letter-spacing:.08em;">${escapeHtml(
              hero.kicker
          )}</p>
`
        : "";
    const title = hero.title
        ? `          <h1 style="margin:0;font:700 24px/1.25 ${FONT};color:${INK};">${escapeHtml(hero.title)}</h1>
`
        : "";
    const subtitle = hero.subtitle
        ? `          <p style="margin:4px 0 0;font:400 16px/1.4 ${FONT};color:${MUTED};">${escapeHtml(hero.subtitle)}</p>
`
        : "";

    const tiles = [];
    if (hero.highlight) tiles.push({ label: hero.highlight.label, value: hero.highlight.value, big: true });
    if (model.replyBy) tiles.push({ label: "Reply by", value: model.replyBy, big: false, link: model.calendarLink });
    // The tiles are the table cells themselves, so a row keeps them the same height.
    const tileCells = tiles
        .map((t, i) => {
            const spacer = i > 0 ? `              <td width="12" style="width:12px;font-size:0;line-height:0;">&nbsp;</td>\n` : "";
            return `${spacer}              <td valign="top" bgcolor="${tint}" style="padding:12px 14px;background:${tint};border-radius:8px;vertical-align:top;">
                <p style="margin:0 0 2px;font:700 11px/1.4 ${FONT};color:${MUTED};text-transform:uppercase;letter-spacing:.06em;">${escapeHtml(
                t.label
            )}</p>
                <p style="margin:0;font:700 ${t.big ? "24px/1.2" : "16px/1.4"} ${FONT};color:${INK};">${escapeHtml(t.value)}</p>${
                t.link
                    ? `
                <p style="margin:6px 0 0;font:700 13px/1.4 ${FONT};"><a href="${escapeHtml(t.link.href)}" style="color:${color};text-decoration:underline;">${escapeHtml(
                          t.link.label
                      )}</a></p>`
                    : ""
            }
              </td>`;
        })
        .join("\n");
    const tileRow = tiles.length
        ? `          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:18px 0 0;table-layout:fixed;">
            <tr>
${tileCells}
            </tr>
          </table>\n`
        : "";
    return kicker + title + subtitle + tileRow;
}

// Second row under the actions: "Save contact" / "Lead sheet (PDF)" links.
function renderFileLinks(model, color) {
    const links = model.fileLinks || [];
    if (!links.length) return "";
    const width = Math.floor(100 / links.length);
    const cells = links
        .map((l, i) => {
            const pad = `${i > 0 ? "padding-left:4px;" : ""}${i < links.length - 1 ? "padding-right:4px;" : ""}`;
            return `              <td width="${width}%" style="${pad}">
                <a href="${escapeHtml(l.href)}" style="display:block;background:#ffffff;border:1px solid ${RULE};border-radius:6px;padding:11px 6px;text-align:center;font:700 14px/1.2 ${FONT};color:${color};text-decoration:none;">${escapeHtml(
                l.label
            )}</a>
              </td>`;
        })
        .join("\n");
    return `          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:8px 0 4px;">
            <tr>
${cells}
            </tr>
          </table>\n`;
}

// A row of one-tap buttons: the first is filled, the rest outlined.
function renderActions(model, color) {
    const phoneHref = model.phone ? telHref(model.phone) : "";
    const buttons = [];
    for (const action of model.actions) {
        if (action === "call" && phoneHref) {
            buttons.push({ href: `tel:${phoneHref}`, label: model.replyName ? `Call ${model.replyName}` : "Call" });
        } else if (action === "text" && phoneHref) {
            buttons.push({ href: `sms:${phoneHref}`, label: "Text" });
        } else if (action === "email" && model.replyTo) {
            buttons.push({ href: mailtoHref(model.replyTo, model.replySubject), label: "Email" });
        }
    }
    if (!buttons.length) return "";
    const width = Math.floor(100 / buttons.length);
    const cells = buttons
        .map((b, i) => {
            const filled = i === 0;
            const pad = `${i > 0 ? "padding-left:4px;" : ""}${i < buttons.length - 1 ? "padding-right:4px;" : ""}`;
            const style = filled
                ? `background:${color};border:2px solid ${color};color:#ffffff;`
                : `background:#ffffff;border:2px solid ${color};color:${color};`;
            return `              <td width="${width}%" style="${pad}">
                <a href="${escapeHtml(b.href)}" style="display:block;${style}border-radius:6px;padding:13px 6px;text-align:center;font:700 15px/1.2 ${FONT};text-decoration:none;">${escapeHtml(
                b.label
            )}</a>
              </td>`;
        })
        .join("\n");
    return `          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:22px 0 4px;">
            <tr>
${cells}
            </tr>
          </table>\n`;
}

function renderHtml(model) {
    const { brand } = model;
    const color = brand.color;

    const bar = brand.logoUrl
        ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(
              brand.name
          )}" height="28" style="display:block;border:0;height:28px;max-height:28px;" />`
        : `<span style="font:700 17px/1.3 ${FONT};color:#ffffff;">${escapeHtml(brand.name)}</span>`;

    const sections = model.sections.map((s) => renderSection(s, color)).join("");

    const buttonLabel = model.replyName ? `Reply to ${model.replyName}` : "Reply";
    const button = model.replyTo && !model.actions
        ? `          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:28px 0 0;">
            <tr>
              <td align="center" bgcolor="${color}" style="border-radius:6px;">
                <a href="${escapeHtml(
                    mailtoHref(model.replyTo, model.replySubject)
                )}" style="display:block;padding:16px 24px;font:700 16px/1.2 ${FONT};color:#ffffff;text-decoration:none;">${escapeHtml(
              buttonLabel
          )}</a>
              </td>
            </tr>
          </table>\n`
        : "";

    const call = model.phone && telHref(model.phone) && !model.actions
        ? `          <p style="margin:14px 0 0;text-align:center;font:400 14px/1.5 ${FONT};color:${MUTED};">or call <a href="tel:${escapeHtml(
              telHref(model.phone)
          )}" style="color:${color};text-decoration:underline;">${escapeHtml(model.phone)}</a></p>\n`
        : "";

    const footerLines = [];
    if (model.submittedAt) footerLines.push(`Submitted ${escapeHtml(model.submittedAt)}`);
    for (const item of model.meta) {
        if (item.name === "source_page") {
            const href = absoluteSourceUrl(item.value, model.siteUrl);
            const shown = escapeHtml(item.value);
            footerLines.push(
                href
                    ? `${escapeHtml(item.label)}: <a href="${escapeHtml(
                          href
                      )}" style="color:${MUTED};text-decoration:underline;">${shown}</a>`
                    : `${escapeHtml(item.label)}: ${shown}`
            );
        } else {
            footerLines.push(`${escapeHtml(item.label)}: ${escapeHtml(item.value)}`);
        }
    }
    if (model.hasCard && !(model.fileLinks || []).length) {
        footerLines.push("Contact card attached: tap it to save this lead to your phone.");
    }
    footerLines.push(`Sent by your website &middot; ${escapeHtml(brand.sentBy || brand.name)}`);

    const footer = footerLines
        .map((line) => `            ${line}`)
        .join("<br />\n");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
<title>${escapeHtml(model.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE_BG};-webkit-text-size-adjust:100%;">
  <div style="display:none;font-size:1px;color:${PAGE_BG};max-height:0;overflow:hidden;">${escapeHtml(
        previewText(model)
    )}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${PAGE_BG};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;">
${
        brand.logo
            ? renderLogoHeader(model, color)
            : `          <tr>
            <td style="padding:16px 24px;background:${color};">${bar}</td>
          </tr>`
    }
          <tr>
            <td style="padding:24px;">
${
    model.hero
        ? renderHero(model, color)
        : `          <h1 style="margin:0 0 20px;font:700 21px/1.3 ${FONT};color:${INK};">${escapeHtml(model.heading)}</h1>\n`
}${model.actions ? renderActions(model, color) : ""}${renderFileLinks(model, color)}${sections}${button}${call}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px 22px;border-top:1px solid ${RULE};font:400 12px/1.7 ${FONT};color:${MUTED};">
${footer}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

function absoluteSourceUrl(value, siteUrl) {
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    if (!siteUrl) return "";
    return `${String(siteUrl).replace(/\/+$/, "")}/${String(value).replace(/^\/+/, "")}`;
}

// Gmail's inbox snippet: first useful values instead of the heading repeated.
function previewText(model) {
    const first = model.sections[0];
    if (!first) return model.heading;
    const bits = [...first.rows, ...first.blocks].slice(0, 3).map((r) => `${r.label}: ${r.value}`);
    return bits.join(" · ").slice(0, 140);
}

/* ------------------------------------------------------------------- text */

function renderText(model) {
    const lines = [model.heading.toUpperCase(), "=".repeat(model.heading.length), ""];
    if (model.hero) {
        if (model.hero.title) lines.push(model.hero.title);
        if (model.hero.subtitle) lines.push(model.hero.subtitle);
        if (model.hero.highlight) lines.push(`${model.hero.highlight.label}: ${model.hero.highlight.value}`);
        if (model.replyBy) lines.push(`Reply by: ${model.replyBy}`);
        if (model.calendarLink) lines.push(`Add a follow-up to your calendar: ${model.calendarLink.href}`);
        lines.push("");
    }

    for (const section of model.sections) {
        if (section.title) {
            lines.push(section.title.toUpperCase(), "-".repeat(section.title.length), "");
        }
        const width = section.rows.reduce((max, row) => Math.max(max, row.label.length), 0);
        for (const row of section.rows) {
            lines.push(`${row.label.padEnd(width)}  ${row.value}`);
        }
        if (section.rows.length) lines.push("");
        for (const block of section.blocks) {
            lines.push(`${block.label}:`);
            for (const line of String(block.value).split(/\r\n|\r|\n/)) lines.push(`  ${line}`);
            lines.push("");
        }
    }

    if (model.replyTo) {
        lines.push(
            model.replyName ? `Reply to ${model.replyName}: ${model.replyTo}` : `Reply: ${model.replyTo}`
        );
    }
    if (model.phone) lines.push(`Call: ${model.phone}`);
    for (const link of model.fileLinks || []) lines.push(`${link.label}: ${link.href}`);
    lines.push("");

    if (model.submittedAt) lines.push(`Submitted ${model.submittedAt}`);
    for (const item of model.meta) lines.push(`${item.label}: ${item.value}`);
    lines.push(`Sent by your website - ${model.brand.sentBy || model.brand.name}`);

    return lines.join("\n");
}

/* ------------------------------------------------------------------ entry */

function renderEmail(payload, config, options = {}) {
    const model = buildModel(payload, config);
    if (options.logoSrc) model.logoSrc = options.logoSrc;
    if (Array.isArray(options.fileLinks)) model.fileLinks = options.fileLinks;
    if (options.calendarLink) model.calendarLink = options.calendarLink;
    return {
        subject: model.subject,
        html: renderHtml(model),
        text: renderText(model),
        replyTo: model.replyTo,
        formName: model.formName,
        isKnownForm: Boolean(config.forms && config.forms[model.formName]),
    };
}

module.exports = {
    renderEmail,
    buildModel,
    escapeHtml,
    formatSubmittedAt,
    isEmail,
    clean,
    firstWord,
    formatPhone,
    telHref,
    urlHref,
    FONT,
    INK,
    MUTED,
    PAGE_BG,
};
