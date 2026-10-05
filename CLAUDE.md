# CLAUDE.md: TODO Client Name

Build facts for this site. Claude reads this before any work. Status, decisions, and to-dos live on the project's Notion page, not here. No PHI in this file or anywhere in this repo.

Template: Zackrfreeman/NewSite (CodeStitch Intermediate Kit, LESS). Build conventions come from the `codestitch-11ty` skill; this file only records what's specific to this site. If this file and the skill disagree on something site-specific, this file wins.

## Pointers

- Notion project page: Brain → TCT → TODO
- Zoho Projects project: TODO
- Zoho task prefix for this site: TODO

## Client

- Business name: TODO
- Industry / what they do: TODO
- TCT plan tier: TODO (Landing / Core / Enhanced / one-time)
- Primary contact for content questions (name, role): TODO
- Production domain (with https://, no trailing slash, must match `client.js`): TODO

## Repo and hosting

- GitHub repo: TODO
- Netlify site name: TODO
- Production branch (must match `backend.branch` in `src/admin/config.yml`): main
- Custom domain connected / HTTPS confirmed: TODO
- DNS managed at: TODO

## Pages

| Page | File | Permalink | LESS file | Nav key / order |
| --- | --- | --- | --- | --- |
| Home | `src/index.html` | `/` | `critical.less` + `local.less` | TODO |
| TODO | TODO | TODO | TODO | TODO |

Pages from the template that were removed: TODO

## Brand

- `:root` colors (`root.less`):
  - `--primary`: TODO
  - `--primaryLight`: TODO
  - `--secondary`: TODO
  - `--secondaryLight`: TODO
  - `--headerColor`: TODO
  - `--bodyTextColor`: TODO
  - `--bodyTextColorWhite`: TODO
- Dark mode (`dark.less` colors, or disabled): TODO
- Fonts (family, weights, files in `src/assets/fonts/`): TODO
- Font preloads in `base.html` (above-the-fold weights only): TODO
- Logos (`src/assets/svgs/`): TODO
- OG image: TODO

## Forms

| Form name | Page | Handler | Notifications go to | Fields |
| --- | --- | --- | --- | --- |
| Contact Form | `/contact/` | Netlify Forms + `submission-created` (ZeptoMail) | TODO (`FORM_NOTIFY_TO`) | name, email, phone, find-us, Message |

- Email layout, sender, and auto-reply wording: `netlify/form-notify.config.js`
- Sender domain verified in ZeptoMail: TODO
- Auto-reply wording approved by client: TODO
- Netlify built-in form notification turned off after live test: TODO

- Spam protection: Netlify honeypot (`bot-field`)
- Success / thank-you behavior: TODO

## CMS

- Decap CMS in use: TODO (yes / no)
- Collections (default: Blog only): TODO
- Starter blog posts at launch: TODO
- Netlify Identity invite-only + Google provider enabled: TODO
- Git Gateway enabled: TODO
- Who has CMS access (roles, not passwords): TODO
- `logo_url` in `config.yml`: TODO

## Integrations and third-party scripts

- Analytics: TODO
- Maps, booking, chat, reviews, or other embeds: TODO
- Where each is loaded (page and position): TODO

## Redirects

- Old site URLs that need 301s in `src/_redirects`: TODO

## Off-limits

- Files, sections, or content Claude must not change: TODO
- Client-managed content (edited through the CMS only): TODO

## Deviations from NewSite

- Anything changed from the template on this site (removed features, custom layouts, extra plugins): TODO
