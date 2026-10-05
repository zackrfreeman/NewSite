"use strict";

// Extras for the form notification function, all driven by per-form keys in
// netlify/form-notify.config.js:
//
//   vcard      -> a contact card (.vcf) attached to the owner's notification
//   pdf        -> a PDF of the whole submission attached to the owner's notification
//   autoReply  -> a short "got it" email to the person who submitted the form
//
// Each builder returns null instead of throwing, so a problem with an extra
// never stops the owner's notification from going out.

const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const {
    buildModel,
    escapeHtml,
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
} = require("./form-email.js");

/* ------------------------------------------------------------------ logo */

const fs = require("fs");
const path = require("path");

// Reads brand.logo.path once. The file ships with the function through
// netlify.toml `included_files`; where it lands differs between local runs and
// Netlify's bundle, so try the likely places. Returns null when it can't be
// found, and the emails fall back to a text header instead of a broken image.
let logoCache;
function loadLogo(config) {
    if (logoCache !== undefined) return logoCache;
    logoCache = null;
    const logo = config && config.brand && config.brand.logo;
    if (!logo || !logo.path) return logoCache;
    const candidates = [
        path.resolve(process.cwd(), logo.path),
        path.resolve(__dirname, logo.path),
        path.resolve(__dirname, "..", logo.path),
        path.resolve(__dirname, "..", "..", logo.path),
        path.resolve("/var/task", logo.path),
    ];
    for (const candidate of candidates) {
        try {
            const bytes = fs.readFileSync(candidate);
            logoCache = { bytes, base64: bytes.toString("base64"), cid: logo.cid || "logo", file: candidate };
            return logoCache;
        } catch (_) {
            // try the next place
        }
    }
    console.warn(`[form-notify] logo not found at ${logo.path}; using a text header`);
    return logoCache;
}

// The config with brand.logo removed, for when the logo file is missing.
function withoutLogo(config) {
    return { ...config, brand: { ...config.brand, logo: null } };
}

/* ------------------------------------------------------------- filenames */

function safeFileName(value, fallback) {
    const name = clean(value)
        .replace(/[\\/:*?"<>|\r\n\t]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
    return name || fallback;
}

function isoDate(isoish) {
    const d = isoish ? new Date(isoish) : new Date();
    if (Number.isNaN(d.getTime())) return "";
    // Local calendar date in Michigan, not UTC.
    return d.toLocaleDateString("en-CA", { timeZone: "America/Detroit" });
}

/* ----------------------------------------------------------------- vCard */

// vCard 3.0: the version iPhone Contacts, Android and Gmail all import.
function vcardEscape(value) {
    return clean(value)
        .replace(/\\/g, "\\\\")
        .replace(/\r\n|\r|\n/g, "\\n")
        .replace(/,/g, "\\,")
        .replace(/;/g, "\\;");
}

// Lines over 75 octets are folded with CRLF + space (RFC 2425).
function vcardFold(line) {
    const out = [];
    let rest = line;
    while (Buffer.byteLength(rest, "utf8") > 75) {
        let cut = 75;
        while (Buffer.byteLength(rest.slice(0, cut), "utf8") > 75) cut--;
        out.push(rest.slice(0, cut));
        rest = " " + rest.slice(cut);
    }
    out.push(rest);
    return out.join("\r\n");
}

function buildVcard(payload, spec, brand) {
    try {
        if (!spec || !spec.vcard) return null;
        const map = spec.vcard;
        const data = (payload && payload.data) || {};
        const fullName = clean(data[map.name]);
        const org = clean(data[map.org]);
        const email = clean(data[map.email]);
        const phone = clean(data[map.phone]);
        const url = clean(data[map.url]);
        if (!isEmail(email) && !telHref(phone)) return null;

        const parts = fullName.split(/\s+/).filter(Boolean);
        const first = parts[0] || "";
        const last = parts.slice(1).join(" ");
        const displayName = fullName || org || email;

        const noteLabel = String(spec.label || "form");
        const noteBits = [`${noteLabel.charAt(0).toUpperCase()}${noteLabel.slice(1)} via ${brand.siteUrl.replace(/^https?:\/\//, "")}`];
        const date = isoDate(payload.created_at);
        if (date) noteBits.push(date);

        const lines = [
            "BEGIN:VCARD",
            "VERSION:3.0",
            `N:${vcardEscape(last)};${vcardEscape(first)};;;`,
            `FN:${vcardEscape(displayName)}`,
        ];
        if (org) lines.push(`ORG:${vcardEscape(org)}`);
        if (isEmail(email)) lines.push(`EMAIL;TYPE=INTERNET:${vcardEscape(email)}`);
        if (telHref(phone)) lines.push(`TEL;TYPE=CELL:${telHref(phone)}`);
        if (url) lines.push(`URL:${vcardEscape(urlHref(url))}`);
        lines.push(`NOTE:${vcardEscape(noteBits.join(", "))}`);
        lines.push("END:VCARD");

        const text = lines.map(vcardFold).join("\r\n") + "\r\n";
        return {
            name: `${safeFileName(displayName, "contact")}.vcf`,
            mime_type: "text/vcard",
            content: Buffer.from(text, "utf8").toString("base64"),
        };
    } catch (error) {
        console.error("[form-notify] contact card skipped:", error && error.message);
        return null;
    }
}

/* ------------------------------------------------------------------- PDF */

const PAGE_W = 612; // US Letter, points
const PAGE_H = 792;
const MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;

function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    const n = m ? parseInt(m[1], 16) : 0x1f487e;
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// The standard PDF fonts only cover WinAnsi (Latin-1 plus smart quotes and
// dashes). Anything else (emoji, CJK) would throw, so it becomes "?".
function makeSanitizer(font) {
    const ok = new Map();
    return (text) =>
        Array.from(String(text).replace(/\t/g, "    "))
            .map((ch) => {
                if (ch === "\n") return ch;
                if (!ok.has(ch)) {
                    try {
                        font.encodeText(ch);
                        ok.set(ch, true);
                    } catch (_) {
                        ok.set(ch, false);
                    }
                }
                return ok.get(ch) ? ch : "?";
            })
            .join("");
}

function wrap(text, font, size, width) {
    const lines = [];
    for (const paragraph of String(text).split(/\r\n|\r|\n/)) {
        if (paragraph.trim() === "") {
            lines.push("");
            continue;
        }
        let line = "";
        for (const word of paragraph.split(/\s+/).filter(Boolean)) {
            const candidate = line ? `${line} ${word}` : word;
            if (font.widthOfTextAtSize(candidate, size) <= width) {
                line = candidate;
                continue;
            }
            if (line) lines.push(line);
            // A single word wider than the column (a long URL) gets hard-split.
            let piece = word;
            while (font.widthOfTextAtSize(piece, size) > width) {
                let cut = piece.length - 1;
                while (cut > 1 && font.widthOfTextAtSize(piece.slice(0, cut), size) > width) cut--;
                lines.push(piece.slice(0, cut));
                piece = piece.slice(cut);
            }
            line = piece;
        }
        lines.push(line);
    }
    return lines;
}

async function buildPdf(payload, config) {
    try {
        const formName = clean(payload && payload.form_name);
        const spec = config.forms && config.forms[formName];
        if (!spec || !spec.pdf) return null;
        if (spec.pdf.layout === "sheet") return await buildSheetPdf(payload, config, spec);

        const model = buildModel(payload, config);
        const doc = await PDFDocument.create();
        const regular = await doc.embedFont(StandardFonts.Helvetica);
        const bold = await doc.embedFont(StandardFonts.HelveticaBold);
        const fix = makeSanitizer(regular);

        const brandColor = hexToRgb(model.brand.color);
        const ink = hexToRgb(INK);
        const muted = hexToRgb(MUTED);
        const rule = hexToRgb("#dee2e6");

        const pdfTitle = clean(spec.pdf.title) || `New ${model.label}`;
        const who = clean(spec.pdf.titleField ? (payload.data || {})[spec.pdf.titleField] : "");
        doc.setTitle(fix(who ? `${pdfTitle} - ${who}` : pdfTitle));
        doc.setAuthor(fix(model.brand.name));
        doc.setCreator(fix(`${model.brand.name} website`));

        let page;
        let y;
        const newPage = () => {
            page = doc.addPage([PAGE_W, PAGE_H]);
            y = PAGE_H - MARGIN;
        };
        const ensure = (needed) => {
            if (y - needed < MARGIN + 18) newPage();
        };
        const text = (str, { font = regular, size = 10.5, color = ink, x = MARGIN } = {}) => {
            page.drawText(str, { x, y, size, font, color });
        };

        newPage();

        // Header
        text(fix(model.brand.name.toUpperCase()), { font: bold, size: 9, color: brandColor });
        y -= 24;
        text(fix(pdfTitle), { font: bold, size: 20 });
        y -= 22;
        if (who) {
            for (const line of wrap(fix(who), regular, 13, CONTENT_W)) {
                text(line, { size: 13 });
                y -= 17;
            }
        }
        if (model.submittedAt) {
            text(fix(`Submitted ${model.submittedAt}`), { size: 9.5, color: muted });
            y -= 14;
        }
        y -= 6;
        page.drawLine({
            start: { x: MARGIN, y },
            end: { x: PAGE_W - MARGIN, y },
            thickness: 1.5,
            color: brandColor,
        });
        y -= 24;

        const LABEL = 9;
        const VALUE = 10.5;
        const LEAD = 14;

        for (const section of model.sections) {
            const entries = [...section.rows, ...section.blocks];
            if (!entries.length) continue;

            if (section.title) {
                ensure(60);
                text(fix(section.title), { font: bold, size: 13, color: brandColor });
                y -= 8;
                page.drawLine({
                    start: { x: MARGIN, y },
                    end: { x: PAGE_W - MARGIN, y },
                    thickness: 0.5,
                    color: rule,
                });
                y -= 18;
            }

            for (const entry of entries) {
                const lines = wrap(fix(entry.value), regular, VALUE, CONTENT_W);
                // Keep a label with at least its first two lines of answer.
                ensure(LABEL + 6 + LEAD * Math.min(lines.length, 2));
                text(fix(entry.label.toUpperCase()), { font: bold, size: LABEL, color: muted });
                y -= LABEL + 6;
                for (const line of lines) {
                    ensure(LEAD);
                    if (line) text(line, { size: VALUE });
                    y -= LEAD;
                }
                y -= 10;
            }
            y -= 8;
        }

        // Footer on every page
        const pages = doc.getPages();
        pages.forEach((p, i) => {
            const label = fix(`${model.brand.name}  |  Page ${i + 1} of ${pages.length}`);
            const w = regular.widthOfTextAtSize(label, 8);
            p.drawText(label, { x: (PAGE_W - w) / 2, y: MARGIN / 2, size: 8, font: regular, color: muted });
        });

        const bytes = await doc.save();
        const date = isoDate(payload.created_at);
        const base = [pdfTitle, who, date].filter(Boolean).join(" - ");
        return {
            name: `${safeFileName(base, "submission")}.pdf`,
            mime_type: "application/pdf",
            content: Buffer.from(bytes).toString("base64"),
        };
    } catch (error) {
        console.error("[form-notify] PDF skipped:", error && error.stack ? error.stack : error);
        return null;
    }
}

// One-page printable lead sheet (pdf.layout "sheet"): logo, the headline
// block from spec.hero, contact rows, the message, then a follow-up log and
// write-in lines for the person working the lead.
async function buildSheetPdf(payload, config, spec) {
    const model = buildModel(payload, config);
    const opts = spec.pdf;
    const doc = await PDFDocument.create();
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const fix = makeSanitizer(regular);

    const accent = hexToRgb(model.brand.color);
    const tint = hexToRgb(model.brand.tint || "#eef3fb");
    const ink = hexToRgb(INK);
    const muted = hexToRgb(MUTED);
    const rule = hexToRgb("#d5dbe3");

    const who = clean(opts.titleField ? (payload.data || {})[opts.titleField] : "");
    const title = clean(opts.title) || `New ${model.label}`;
    doc.setTitle(fix(who ? `${title} - ${who}` : title));
    doc.setAuthor(fix(model.brand.name));
    doc.setCreator(fix(`${model.brand.name} website`));

    let page = doc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;
    const right = PAGE_W - MARGIN;
    const newPage = () => {
        page = doc.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - MARGIN;
    };
    const ensure = (needed) => {
        if (y - needed < MARGIN + 6) newPage();
    };
    const draw = (str, x, size, font = regular, color = ink) =>
        page.drawText(str, { x, y, size, font, color });
    const drawRight = (str, size, font = regular, color = ink) =>
        page.drawText(str, { x: right - font.widthOfTextAtSize(str, size), y, size, font, color });

    // Header: logo left, kicker + received time right.
    const logo = loadLogo(config);
    let headerHeight = 34;
    if (logo) {
        try {
            const img = await doc.embedPng(logo.bytes);
            const w = 112;
            const h = (img.height / img.width) * w;
            page.drawImage(img, { x: MARGIN, y: y - h + 6, width: w, height: h });
            headerHeight = h;
        } catch (error) {
            console.warn("[form-notify] PDF logo skipped:", error && error.message);
        }
    }
    if (headerHeight === 34 && !logo) {
        draw(fix(model.brand.name), MARGIN, 18, bold, accent);
    }
    const kicker = fix((model.hero && model.hero.kicker) || title).toUpperCase();
    y -= 6;
    drawRight(kicker, 11, bold, accent);
    y -= 16;
    if (model.submittedAt) drawRight(fix(`Received ${model.submittedAt}`), 9.5, regular, muted);
    y = PAGE_H - MARGIN - headerHeight - 6;
    page.drawRectangle({ x: MARGIN, y, width: right - MARGIN, height: 3, color: accent });
    y -= 28;

    // Headline
    const hero = model.hero || {};
    const headline = hero.title || who || title;
    for (const line of wrap(fix(headline), bold, 22, right - MARGIN)) {
        draw(line, MARGIN, 22, bold);
        y -= 26;
    }
    if (hero.subtitle) {
        y += 4;
        draw(fix(hero.subtitle), MARGIN, 13, regular, muted);
        y -= 22;
    }

    // Tiles
    const tiles = [];
    if (hero.highlight) tiles.push([hero.highlight.label, hero.highlight.value]);
    if (model.submittedAt) tiles.push(["Received", model.submittedAt]);
    if (model.replyBy) tiles.push(["Reply by", model.replyBy]);
    if (tiles.length) {
        const gap = 10;
        const tileW = (right - MARGIN - gap * (tiles.length - 1)) / tiles.length;
        const tileH = 46;
        y -= 6;
        tiles.forEach(([label, value], i) => {
            const x = MARGIN + i * (tileW + gap);
            page.drawRectangle({ x, y: y - tileH, width: tileW, height: tileH, color: tint });
            page.drawText(fix(String(label).toUpperCase()), { x: x + 12, y: y - 17, size: 8, font: bold, color: muted });
            const big = i === 0 && hero.highlight;
            let size = big ? 18 : 11;
            let text = fix(String(value));
            while (size > 7 && bold.widthOfTextAtSize(text, size) > tileW - 24) size -= 0.5;
            page.drawText(text, { x: x + 12, y: y - (big ? 37 : 34), size, font: bold, color: ink });
        });
        y -= tileH + 22;
    }

    // Contact rows (label left, value right of it)
    const rows = [];
    for (const section of model.sections) rows.push(...section.rows);
    const labelW = 110;
    for (const row of rows) {
        const lines = wrap(fix(row.value), regular, 11, right - MARGIN - labelW);
        ensure(18 * lines.length + 8);
        draw(fix(row.label), MARGIN, 10, bold, muted);
        lines.forEach((line, i) => {
            page.drawText(line, { x: MARGIN + labelW, y: y - i * 15, size: 11, font: regular, color: ink });
        });
        y -= 15 * lines.length + 6;
        page.drawLine({ start: { x: MARGIN, y: y + 2 }, end: { x: right, y: y + 2 }, thickness: 0.5, color: rule });
        y -= 12;
    }

    // Long answers in an outlined box
    for (const section of model.sections) {
        for (const block of section.blocks) {
            const lines = wrap(fix(block.value), regular, 11, right - MARGIN - 24);
            ensure(40 + Math.min(lines.length, 4) * 15);
            y -= 4;
            draw(fix(block.label.toUpperCase()), MARGIN, 8.5, bold, muted);
            y -= 10;
            let remaining = lines;
            while (remaining.length) {
                const room = Math.max(1, Math.floor((y - MARGIN - 36) / 15) - 1);
                const chunk = remaining.slice(0, room);
                remaining = remaining.slice(room);
                const boxH = chunk.length * 15 + 18;
                page.drawRectangle({
                    x: MARGIN,
                    y: y - boxH,
                    width: right - MARGIN,
                    height: boxH,
                    borderColor: rule,
                    borderWidth: 1,
                });
                chunk.forEach((line, i) => {
                    if (line) page.drawText(line, { x: MARGIN + 12, y: y - 20 - i * 15, size: 11, font: regular, color: ink });
                });
                y -= boxH + 18;
                if (remaining.length) newPage();
            }
        }
    }

    // Follow-up log
    const followUp = Array.isArray(opts.followUp) ? opts.followUp : [];
    if (followUp.length) {
        ensure(40 + followUp.length * 26);
        y -= 6;
        draw("FOLLOW-UP", MARGIN, 8.5, bold, accent);
        y -= 20;
        for (const item of followUp) {
            page.drawRectangle({ x: MARGIN, y: y - 2, width: 11, height: 11, borderColor: ink, borderWidth: 1 });
            draw(fix(item), MARGIN + 20, 11);
            const dateX = MARGIN + 260;
            page.drawText("Date", { x: dateX, y, size: 9, font: regular, color: muted });
            page.drawLine({ start: { x: dateX + 26, y: y - 2 }, end: { x: dateX + 120, y: y - 2 }, thickness: 0.6, color: rule });
            page.drawText("By", { x: dateX + 134, y, size: 9, font: regular, color: muted });
            page.drawLine({ start: { x: dateX + 150, y: y - 2 }, end: { x: right, y: y - 2 }, thickness: 0.6, color: rule });
            y -= 22;
        }
        y -= 6;
    }

    // Write-in lines
    for (const block of Array.isArray(opts.writeIn) ? opts.writeIn : []) {
        const count = Math.max(1, block.lines || 3);
        ensure(14 + count * 20);
        draw(fix(String(block.label).toUpperCase()), MARGIN, 8.5, bold, accent);
        y -= 8;
        for (let i = 0; i < count; i++) {
            y -= 20;
            page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 0.6, color: rule });
        }
        y -= 16;
    }

    // Footer
    const pages = doc.getPages();
    const sig = Array.isArray(model.brand.signature) ? model.brand.signature.join("  |  ") : model.brand.name;
    pages.forEach((p, i) => {
        const label = fix(pages.length > 1 ? `${sig}  |  Page ${i + 1} of ${pages.length}` : sig);
        const w = regular.widthOfTextAtSize(label, 8);
        p.drawText(label, { x: (PAGE_W - w) / 2, y: MARGIN / 2, size: 8, font: regular, color: muted });
    });

    const bytes = await doc.save();
    const date = isoDate(payload.created_at);
    const base = [title, who, date].filter(Boolean).join(" - ");
    return {
        name: `${safeFileName(base, "submission")}.pdf`,
        mime_type: "application/pdf",
        content: Buffer.from(bytes).toString("base64"),
    };
}

/* ----------------------------------------------------------- file links */

// "Save contact" and "Lead sheet (PDF)" buttons. Email buttons can only be
// links, so each points at netlify/functions/lead-file.js, which rebuilds the
// file on request. The link carries just the fields that file needs,
// compressed and HMAC-signed, so nothing is stored and a URL can't be edited
// into producing a different file. The key comes from FORM_LINK_SECRET, or is
// derived from ZEPTOMAIL_TOKEN so no extra setup is needed (rotating the
// token retires old links).

const crypto = require("crypto");
const zlib = require("zlib");

const LINK_MAX_AGE_DAYS = 365;

function linkKey() {
    const explicit = String(process.env.FORM_LINK_SECRET || "").trim();
    const base = explicit || String(process.env.ZEPTOMAIL_TOKEN || "").trim();
    if (!base) return null;
    return crypto.createHash("sha256").update(`form-links:${base}`).digest();
}

function b64url(buf) {
    return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(str) {
    return Buffer.from(String(str).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

// Only the fields the card and the PDF use: never ip, user agent, or tracking.
function fieldsForFiles(spec) {
    const names = new Set();
    for (const section of spec.sections || []) {
        for (const field of section.fields) names.add(typeof field === "string" ? field : field.name);
    }
    for (const name of Object.values(spec.vcard || {})) names.add(name);
    if (spec.hero) {
        [spec.hero.titleField, spec.hero.subtitleField, spec.hero.highlight && spec.hero.highlight.field].forEach(
            (n) => n && names.add(n)
        );
    }
    if (spec.pdf && spec.pdf.titleField) names.add(spec.pdf.titleField);
    if (spec.followUp && spec.followUp.messageField) names.add(spec.followUp.messageField);
    return [...names].filter(Boolean);
}

// Where the button links should point. Netlify records the page each form
// was submitted from (data.referrer); that's the preview on a branch deploy
// and the real domain in production. The browser supplies it, so it's only
// trusted when it's this site's own domain or one of its netlify.app deploys;
// otherwise links fall back to the production URL. That keeps a spammer from
// pointing the owner's buttons at another site.
function linkBaseFor(payload, config) {
    const brand = (config && config.brand) || {};
    const fallback = clean(brand.siteUrl || process.env.URL || (payload && payload.site_url));
    const hosts = new Set();
    for (const u of [brand.siteUrl, process.env.URL, payload && payload.site_url]) {
        try {
            if (u) {
                const h = new URL(u).hostname.toLowerCase();
                hosts.add(h);
                hosts.add(h.startsWith("www.") ? h.slice(4) : `www.${h}`);
            }
        } catch (_) {
            // ignore
        }
    }
    const site = clean(brand.netlifySite || process.env.SITE_NAME).toLowerCase();
    try {
        const ref = new URL(clean(payload && payload.data && payload.data.referrer));
        const host = ref.hostname.toLowerCase();
        const trusted =
            ref.protocol === "https:" &&
            (hosts.has(host) || (site && (host === `${site}.netlify.app` || host.endsWith(`--${site}.netlify.app`))));
        if (trusted) return ref.origin;
    } catch (_) {
        // no usable referrer
    }
    return fallback;
}

function buildFileLinks(payload, config, baseUrl) {
    try {
        const formName = clean(payload && payload.form_name);
        const spec = config.forms && config.forms[formName];
        const key = linkKey();
        const base = clean(baseUrl).replace(/\/+$/, "");
        if (!spec || !key || !base || spec.fileLinks === false) return [];

        const data = (payload && payload.data) || {};
        const kept = {};
        for (const name of fieldsForFiles(spec)) {
            if (!clean(data[name])) continue;
            kept[name] = String(data[name]);
        }
        const body = { f: formName, c: payload.created_at || "", i: Math.floor(Date.now() / 1000), d: kept };
        const packed = b64url(zlib.deflateRawSync(Buffer.from(JSON.stringify(body), "utf8")));
        const sig = b64url(crypto.createHmac("sha256", key).update(packed).digest()).slice(0, 32);
        const href = (type) => `${base}/.netlify/functions/lead-file?t=${type}&p=${packed}&s=${sig}`;

        const links = [];
        if (spec.vcard && buildVcard(payload, spec, config.brand)) links.push({ label: "Save contact", href: href("vcf") });
        if (spec.pdf) links.push({ label: spec.pdf.buttonLabel || "Lead sheet (PDF)", href: href("pdf") });
        // The calendar link opens a small chooser page (Google or .ics), not a
        // button in this row: the renderer shows it in the Reply-by tile.
        if (spec.followUp && followUpEvent(payload, config)) {
            links.calendar = { label: "Add to calendar", href: href("cal") };
        }
        return links;
    } catch (error) {
        console.error("[form-notify] file links skipped:", error && error.message);
        return [];
    }
}

// Verifies a link and turns it back into a payload. Returns null if the
// signature is wrong, the link is too old, or anything fails to decode.
function readFileLink(packed, sig) {
    try {
        const key = linkKey();
        if (!key || !packed || !sig) return null;
        const expected = b64url(crypto.createHmac("sha256", key).update(String(packed)).digest()).slice(0, 32);
        const a = Buffer.from(String(sig));
        const b = Buffer.from(expected);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
        const body = JSON.parse(zlib.inflateRawSync(fromB64url(packed)).toString("utf8"));
        if (!body || typeof body.d !== "object") return null;
        const ageDays = (Date.now() / 1000 - Number(body.i || 0)) / 86400;
        if (!(ageDays >= -1 && ageDays <= LINK_MAX_AGE_DAYS)) return null;
        return { form_name: String(body.f || ""), created_at: String(body.c || ""), data: body.d };
    } catch (_) {
        return null;
    }
}

/* ------------------------------------------------------ follow-up reminder */

// "Add to calendar" link in the Reply-by tile: a Google Calendar event with
// the lead's details, set spec.followUp.hoursBefore (default 2) ahead of the
// reply-by deadline and moved inside business hours so it never lands at 3 AM.

const TZ = "America/Detroit";

// Wall-clock parts of a Date in Michigan.
function localParts(date) {
    const p = new Intl.DateTimeFormat("en-US", {
        timeZone: TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    })
        .formatToParts(date)
        .reduce((acc, part) => ((acc[part.type] = part.value), acc), {});
    return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
}

function pad(n) {
    return String(n).padStart(2, "0");
}

// Local wall time -> "YYYYMMDDTHHMMSS" (Google reads it in ctz).
function stamp({ y, mo, d, h, mi }) {
    return `${y}${pad(mo)}${pad(d)}T${pad(h)}${pad(mi)}00`;
}

function shiftDay(parts, days) {
    const t = new Date(Date.UTC(parts.y, parts.mo - 1, parts.d + days));
    return { ...parts, y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function followUpSlot(createdAt, rule) {
    const hours = rule.replyWithinHours;
    const start = createdAt ? new Date(createdAt) : new Date();
    if (!hours || Number.isNaN(start.getTime())) return null;
    const before = rule.hoursBefore === undefined ? 2 : rule.hoursBefore;
    const open = rule.openHour === undefined ? 9 : rule.openHour;
    const close = rule.closeHour === undefined ? 17 : rule.closeHour;
    let at = localParts(new Date(start.getTime() + (hours - before) * 3600 * 1000));
    const lastStart = { h: close - 1, mi: 0 };
    if (at.h < open) at = { ...shiftDay(at, -1), ...lastStart };
    else if (at.h >= close) at = { ...at, ...lastStart };
    // Never earlier than the submission itself.
    const received = localParts(start);
    if (stamp(at) < stamp(received)) at = received;
    // Local wall-clock math done in UTC space, then read back as-is.
    const endUtc = new Date(Date.UTC(at.y, at.mo - 1, at.d, at.h, at.mi) + (rule.minutes || 15) * 60000);
    return {
        start: stamp(at),
        end: stamp({ y: endUtc.getUTCFullYear(), mo: endUtc.getUTCMonth() + 1, d: endUtc.getUTCDate(), h: endUtc.getUTCHours(), mi: endUtc.getUTCMinutes() }),
    };
}

// The follow-up event for a submission: title, details and local start/end
// stamps. Null when the form has no followUp rule.
function followUpEvent(payload, config) {
    const formName = clean(payload && payload.form_name);
    const spec = config.forms && config.forms[formName];
    if (!spec || !spec.followUp || !spec.replyWithinHours) return null;
    const slot = followUpSlot(payload.created_at, { ...spec.followUp, replyWithinHours: spec.replyWithinHours });
    if (!slot) return null;

    const data = (payload && payload.data) || {};
    const model = buildModel(payload, config);
    const hero = model.hero || {};
    const who = hero.title || hero.subtitle || "new lead";
    const title = `Follow up: ${who}${spec.followUp.titleSuffix ? ` ${spec.followUp.titleSuffix}` : ""}`;

    const lines = [];
    if (model.replyBy) lines.push(`Reply by ${model.replyBy}.`, "");
    if (hero.subtitle) lines.push(`Contact: ${hero.subtitle}`);
    if (model.phone) lines.push(`Phone: ${model.phone}`);
    if (model.replyTo) lines.push(`Email: ${model.replyTo}`);
    if (hero.highlight) lines.push(`${hero.highlight.label}: ${hero.highlight.value}`);
    const note = spec.followUp.messageField ? clean(data[spec.followUp.messageField]) : "";
    if (note) lines.push("", note.length > 600 ? `${note.slice(0, 600)}…` : note);

    return { title, details: lines.join("\n"), start: slot.start, end: slot.end, whenText: slotText(slot.start) };
}

// "20260930T130000" -> "Wed Sep 30, 1:00 PM"
function slotText(st) {
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(st);
    if (!m) return "";
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
    return new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }).format(d);
}

function googleCalendarHref(event) {
    const params = new URLSearchParams({
        action: "TEMPLATE",
        text: event.title,
        dates: `${event.start}/${event.end}`,
        ctz: TZ,
        details: event.details,
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// Local Michigan wall time "YYYYMMDDTHHMMSS" -> UTC "YYYYMMDDTHHMMSSZ",
// so the .ics needs no VTIMEZONE block (Outlook is fussy about those).
function localStampToUtc(st) {
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(st);
    const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    const seen = localParts(new Date(guess));
    const offset = Date.UTC(seen.y, seen.mo - 1, seen.d, seen.h, seen.mi) - guess;
    return new Date(guess - offset).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsEscape(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

// Standard calendar file: Apple Calendar, Outlook, Zoho, and Google (import).
function buildIcs(event, config) {
    const uid = crypto
        .createHash("sha256")
        .update(`${event.title}|${event.start}`)
        .digest("hex")
        .slice(0, 24);
    const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        `PRODID:-//${icsEscape(config.brand.name)}//Form follow-up//EN`,
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        `UID:${uid}@form-followup`,
        `DTSTAMP:${now}`,
        `DTSTART:${localStampToUtc(event.start)}`,
        `DTEND:${localStampToUtc(event.end)}`,
        `SUMMARY:${icsEscape(event.title)}`,
        `DESCRIPTION:${icsEscape(event.details)}`,
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${icsEscape(event.title)}`,
        "TRIGGER:-PT0M",
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR",
    ];
    return lines.map(vcardFold).join("\r\n") + "\r\n";
}

// Direct Google link: used only when there's no signed chooser link (no key
// or no site URL), so the button still does something useful.
function buildCalendarLink(payload, config) {
    try {
        const event = followUpEvent(payload, config);
        return event ? { label: "Add to calendar", href: googleCalendarHref(event) } : null;
    } catch (error) {
        console.error("[form-notify] calendar link skipped:", error && error.message);
        return null;
    }
}

/* ------------------------------------------------------------ auto-reply */

// Auto-replies go to an address a stranger typed, so they never echo back
// anything else the stranger typed (their message, their full name): that is
// how contact forms get used to send spam. First name only, and only when it
// looks like a name.
function safeFirstName(value) {
    const first = firstWord(value);
    return /^[\p{L}][\p{L}'’.-]{0,29}$/u.test(first) ? first : "";
}

function fill(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, (_, key) => (key in vars ? vars[key] : ""));
}

function buildAutoReply(payload, config, options = {}) {
    try {
        const formName = clean(payload && payload.form_name);
        const spec = config.forms && config.forms[formName];
        if (!spec || !spec.autoReply) return null;
        const reply = spec.autoReply;
        const data = (payload && payload.data) || {};

        const to = clean(data[spec.replyToField]);
        if (!isEmail(to)) return null;

        const { brand } = config;
        const first = safeFirstName(data[spec.nameField]);
        const vars = { greeting: first ? `Hi ${first},` : "Hi there," };

        const subject = fill(reply.subject, vars);
        const paragraphs = (reply.paragraphs || []).map((p) => fill(p, vars));
        const signature = (brand.signature || [brand.name]).filter(Boolean);
        const cta = reply.button && reply.button.href ? reply.button : null;

        const color = brand.color;
        const bar = `<span style="font:700 17px/1.3 ${FONT};color:#ffffff;">${escapeHtml(brand.name)}</span>`;
        const body = [vars.greeting, ...paragraphs]
            .map(
                (p) =>
                    `          <p style="margin:0 0 16px;font:400 16px/1.6 ${FONT};color:${INK};">${escapeHtml(p)}</p>`
            )
            .join("\n");
        const button = cta
            ? `          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
            <tr>
              <td bgcolor="${color}" style="border-radius:6px;">
                <a href="${escapeHtml(cta.href)}" style="display:inline-block;padding:14px 22px;font:700 15px/1.2 ${FONT};color:#ffffff;text-decoration:none;">${escapeHtml(
                  cta.label
              )}</a>
              </td>
            </tr>
          </table>`
            : "";
        const sig = signature
            .map((line, i) => {
                const phoneHref = telHref(line);
                const shown = escapeHtml(line);
                if (i > 0 && phoneHref && /\d{3}.*\d{4}/.test(line)) {
                    return `<a href="tel:${escapeHtml(phoneHref)}" style="color:${color};text-decoration:none;">${shown}</a>`;
                }
                return i === 0 ? `<strong>${shown}</strong>` : shown;
            })
            .join("<br />");

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light only" />
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE_BG};-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${PAGE_BG};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;">
${
    brand.logo
        ? `          <tr>
            <td align="center" style="padding:22px 24px 18px;background:#ffffff;border-bottom:4px solid ${color};">
              <img src="${escapeHtml(options.logoSrc || `cid:${brand.logo.cid}`)}" width="${brand.logo.width}" height="${
                  brand.logo.height
              }" alt="${escapeHtml(brand.name)}" style="display:block;border:0;width:${brand.logo.width}px;max-width:100%;height:auto;" />
            </td>
          </tr>`
        : `          <tr>
            <td style="padding:16px 24px;background:${color};">${bar}</td>
          </tr>`
}
          <tr>
            <td style="padding:28px 24px 24px;">
${body}
${button}
          <p style="margin:8px 0 0;font:400 15px/1.6 ${FONT};color:${INK};">${sig}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px;border-top:1px solid #e9ecef;font:400 12px/1.5 ${FONT};color:${MUTED};">
            ${escapeHtml(fill(reply.footer || "You're getting this because you filled out a form on {site}.", { ...vars, site: brand.siteUrl.replace(/^https?:\/\//, "") }))}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

        const text = [
            vars.greeting,
            "",
            ...paragraphs.flatMap((p) => [p, ""]),
            ...(cta ? [`${cta.label}: ${cta.href}`, ""] : []),
            ...signature,
        ].join("\n");

        return { to, subject, html, text };
    } catch (error) {
        console.error("[form-notify] auto-reply skipped:", error && error.message);
        return null;
    }
}

module.exports = {
    buildVcard,
    buildPdf,
    buildAutoReply,
    buildFileLinks,
    linkBaseFor,
    readFileLink,
    buildCalendarLink,
    followUpEvent,
    googleCalendarHref,
    buildIcs,
    loadLogo,
    withoutLogo,
    formatPhone,
};
