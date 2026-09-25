# NewSite — TriCity Technologies Starter Kit

The starting point for every TriCity Technologies client website. It's an Eleventy static site with Decap CMS for client-managed blog posts, LESS for styling, and Netlify for hosting, built to hold [CodeStitch](https://codestitch.app/) components.

**Built on CodeStitch's Intermediate Website Kit (LESS).** See [Credits](#credits) for details.

## Contents

- [What's different from the CodeStitch kit](#whats-different-from-the-codestitch-kit)
- [Stack](#stack)
- [Starting a new client site](#starting-a-new-client-site)
- [Commands](#commands)
- [File structure](#file-structure)
- [Working in the kit](#working-in-the-kit)
- [Deploying to Netlify](#deploying-to-netlify)
- [Credits](#credits)

## What's different from the CodeStitch kit

- **Blog sections on the home page** that pull the latest posts from the `post` collection automatically.
- **Share buttons** on blog posts (Facebook, X, Pinterest, LinkedIn) in `src/_includes/layouts/post.html`.
- **Blog image galleries** with fslightbox.
- **Clean blog permalinks:** posts get a sanitized `/blog/<slug>/` URL unless the post sets its own.
- **Image processing** through CodeStitch's sharp-images plugin, plus Netlify build caching for processed images.
- **Dark mode** (`dark.less` and `dark.js`) loaded on every page.

## Stack

| Piece | What it does |
| --- | --- |
| [Eleventy 2](https://www.11ty.dev/) + Nunjucks | Builds the static site from `src/` into `public/` |
| LESS | Styles; compiled from `src/assets/less/` into `src/assets/css/` |
| [Decap CMS](https://decapcms.org/) | Blog editor for clients at `/admin` (Git Gateway) |
| esbuild | Bundles and minifies JavaScript |
| Netlify | Hosting, Identity for CMS logins, Lighthouse reports on every deploy |

## Starting a new client site

1. On GitHub, click **Use this template** → **Create a new repository**, then clone it and open it in VS Code.
2. Run `npm install`, then `npm start`.
3. Work through the setup checklist:
   - [ ] `src/_data/client.js`: business name, email, phone, address, map link, socials, and domain (with `https://` and no trailing slash).
   - [ ] `src/assets/less/root.less`: brand colors in the `:root` variables, the client's fonts, and the shared `cs-` styles.
   - [ ] Fonts: add the client's font files to `src/assets/fonts/`, remove Roboto if it's unused, and update the font preloads in `src/_includes/layouts/base.html`.
   - [ ] Logos in `src/assets/svgs/`, the OG image (`src/assets/images/logo-small.png`), favicons, and `site.webmanifest`.
   - [ ] `src/admin/config.yml`: set `logo_url` to the client's logo (a full URL).
   - [ ] `package.json`: set `name`, `description`, and the `repository` URL for the client repo.
   - [ ] Replace demo pages, blog posts, and images, and delete what the client doesn't need.
   - [ ] Add a `CLAUDE.md` with this site's build facts (client, pages, colors and fonts, Netlify site, forms).
4. Deploy (see [Deploying to Netlify](#deploying-to-netlify)).

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Clears `public/`, then runs the LESS watcher, the Eleventy dev server, and the local Decap server together |
| `npm run build` | Compiles LESS, then builds the production site into `public/` (minified) |

`npm start` sets `ELEVENTY_ENV=DEV` and `npm run build` sets `ELEVENTY_ENV=PROD`. Anything production-only (like minification) checks `isProduction` from `src/config/server.js`.

## File structure

```
.
├── src/
│   ├── _data/client.js          # Client info: name, contact, socials, domain
│   ├── _includes/
│   │   ├── components/          # header, footer, cta, featured-post
│   │   └── layouts/             # base.html (every page), post.html (blog posts)
│   ├── admin/                   # Decap CMS (index.html + config.yml)
│   ├── assets/
│   │   ├── less/                # EDIT STYLES HERE
│   │   ├── css/                 # Compiled output. Don't edit.
│   │   ├── fonts/  images/  js/  svgs/  favicons/
│   ├── config/                  # Eleventy config pieces (css, js, sitemap, server, dates)
│   ├── content/
│   │   ├── pages/               # Site pages, plus _template.txt
│   │   └── blog/                # Markdown posts (managed by the CMS)
│   ├── _redirects               # Netlify redirects
│   ├── index.html               # Home page
│   ├── robots.html              # Builds robots.txt
│   └── sitemap.html             # Builds sitemap.xml
├── .eleventy.js                 # Plugins, collections, passthroughs, filters
├── netlify.toml                 # Build command, publish folder, Netlify plugins
└── package.json
```

`public/` is build output. Never edit it; it's overwritten on every build.

## Working in the kit

### Client data

Everything in `src/_data/client.js` is available in any template as `{{ client.key }}`. For example, the footer uses `{{ client.email }}`. The `<head>`, sitemap, and robots.txt all read from this file, so fill it out first.

### Styles

- Edit `.less` files only. Changes in `src/assets/css/` are overwritten.
- `root.less` holds global rules (variables, fonts, and shared `cs-` styles), `critical.less` covers the home page above the fold, `local.less` covers the rest of the home page, and every other page gets its own LESS file.
- When pasting a Stitch, use its **LESS** code. Move its `:root` variables, `font-family`, and `.cs-topper`, `.cs-title`, `.cs-text`, and `.cs-button-solid` base styles into `root.less` once, and delete them from the Stitch.

### Adding a page

1. Copy `src/content/pages/_template.txt` and rename it to `your-page.html`.
2. Fill in the front matter:

```yaml
---
title: 'Page title for <title> and OG tags'
description: 'Description for <meta> description and OG tags'
preloadImg: '/assets/images/imagename.format'
permalink: 'page-path/'
eleventyNavigation:
    key: Name in the navigation
    order: 1000
    parent: Optional. Another page's key, to make this a dropdown item
    hideOnMobile: Optional. true hides it at 1023px and below
    hideOnDesktop: Optional. true hides it at 1024px and above
---
```

3. Put page-specific stylesheets in `{% block head %}` and the page HTML in `{% block body %}`. `base.html` already provides the `<main>` wrapper, header, and footer.

Every page in `content/` is added to the sitemap automatically. The home page is tagged manually because it lives outside `content/`.

### Navigation

The header builds itself from each page's `eleventyNavigation` front matter, including dropdowns and the `cs-active` class. To swap in a different CodeStitch navigation, copy this kit's `.cs-ul-wrapper` into the new Stitch so auto-rendering keeps working.

If you ever hand-code nav links instead, add the active class per link:

```html
<a href="/contact" class="cs-li-link {% if page.url == '/contact/' %} cs-active {% endif %}">Contact</a>
```

### Blog and CMS

- Posts are Markdown files in `src/content/blog/`. `blog.json` applies the `post.html` layout, the `post` tag, and the blog stylesheet to all of them.
- Clients create and edit posts at `/admin`. Saving commits to the repo, and Netlify rebuilds the site in about a minute.
- CMS uploads go to `src/assets/images/blog/`.
- To add other client-editable content (a menu, job listings, a portfolio), add a collection in `src/admin/config.yml`. See the [Decap docs](https://decapcms.org/docs/intro/).

### Redirects

Add Netlify redirect rules to `src/_redirects`. See [Netlify redirects](https://docs.netlify.com/routing/redirects/).

## Deploying to Netlify

1. In Netlify, choose **Add new site** → **Import an existing project** → GitHub, then pick the repo. `netlify.toml` already sets the build command and publish folder.
2. Deploy, and confirm the build succeeds.
3. Set up the CMS:
   1. **Site configuration → Identity → Enable Identity**.
   2. Set **Registration** to **Invite only**.
   3. Under **External providers**, enable **Google** for one-click client logins.
   4. Under **Services → Git Gateway**, click **Enable Git Gateway**.
   5. Invite the client (and yourself), then test at `/admin`.
4. Connect the client's domain and confirm HTTPS.

Before handoff, check Lighthouse (shown on each deploy), form submissions, `sitemap.xml`, `robots.txt`, the 404 page, and redirects.

## Credits

This kit is my customized version of the **[Intermediate Website Kit (LESS)](https://github.com/CodeStitchOfficial/Intermediate-Website-Kit-LESS)** by [CodeStitch](https://codestitch.app/). The Eleventy setup, Decap CMS configuration, auto-rendered navigation, and base styles are theirs; the customizations listed above are mine. The site sections are built from the [CodeStitch component library](https://codestitch.app/).

- CodeStitch [documentation](https://codestitch.app/documentation) and [Page Speed Handbook](https://codestitch.app/page-speed-handbook)
- CodeStitch's original kit is released under [CC0 1.0](LICENSE.md), which is kept here.

Maintained by Zack Freeman, [TriCity Technologies](https://tricitytech.net).
