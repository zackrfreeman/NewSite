// Imports
const pluginEleventyNavigation = require("@11ty/eleventy-navigation");
const pluginMinifier = require("@sherby/eleventy-plugin-files-minifier");
const pluginSitemap = require("@quasibit/eleventy-plugin-sitemap");

// Configs
const configCss = require("./src/config/css");
const configJs = require("./src/config/javascript");
const configSitemap = require("./src/config/sitemap");
const configServer = require("./src/config/server");

// Other
const filterPostDate = require("./src/config/postDate");
const isProduction = configServer.isProduction;


module.exports = function (eleventyConfig) {
    /**=====================================================================
          EXTENSIONS - Recognising non-default languages as templates 
    =======================================================================*/
    /** https://www.11ty.dev/docs/languages/custom/ */

    /**
     *  CSS EXTENSION
     *  Setting up CSS files to be recognised as aN eleventy template language. This allows our minifier to read CSS files and minify them
     */
    eleventyConfig.addTemplateFormats("css");
    eleventyConfig.addExtension("css", configCss);

    /**
     *  JS EXTENSION
     *  Sets up JS files as an eleventy template language, which are compiled by esbuild. Allows bundling and minification of JS
     */
    eleventyConfig.addTemplateFormats("js");
    eleventyConfig.addExtension("js", configJs);
    /**=====================================================================
                                END EXTENSIONS
    =======================================================================*/


    /**=====================================================================
                  PLUGINS - Adds additional eleventy functionality 
    =======================================================================*/
    /** https://www.11ty.dev/docs/plugins/ */

    /**
     *  ELEVENTY NAVIGATION
     *  Sets up the eleventy navigation plugin for a scalable navigation as used in _includes/components/header.html
     *  https://github.com/11ty/eleventy-navigation
     */
    eleventyConfig.addPlugin(pluginEleventyNavigation);

    /**
     *  AUTOMATIC SITEMAP GENERATION 
     *  Automatically generate a sitemap, using the domain in _data/client.json
     *  https://www.npmjs.com/package/@quasibit/eleventy-plugin-sitemap
     */
    eleventyConfig.addPlugin(pluginSitemap, configSitemap);

    /**
     *  MINIFIER 
     *  When in production ("npm run build" is ran), minify all HTML, CSS, JSON, XML, XSL and webmanifest files.
     *  https://github.com/benjaminrancourt/eleventy-plugin-files-minifier
     */
    if (isProduction) {
        eleventyConfig.addPlugin(pluginMinifier);
    }
    /**=====================================================================
                                END PLUGINS
    =======================================================================*/
/**=====================================================================
        COLLECTIONS - Process and sanitize permalinks for blog posts
    =======================================================================*/
    eleventyConfig.addCollection("post", function(collection) {
        // 1. Get the files using the glob pattern
        const posts = collection.getFilteredByGlob("./src/content/blog/*.md"); 
        
        // 2. ADD THE CONSOLE LOG HERE (After getting files, Before mapping)
        console.log(`[DEBUG] Found ${posts.length} files for 'post' collection:`, posts.map(p => p.inputPath));
        // --------------------------------------------------------------------

        // 3. Now, map through the 'posts' array you just logged
        return posts.map(post => { 
            // --- Permalink handling logic (Keep as is) ---
            if (post.data.permalink) {
              // If permalink already exists in front matter, return immediately.
              // Added curly braces for clarity, though optional for single statement.
              return post; 
            }
    
            let safeSlug = post.fileSlug
                .toLowerCase()
                .replace(/[^\w\d-]+/g, "-")
                .replace(/(^-|-$)/g, "");
    
            post.data.permalink = `/blog/${safeSlug}/`; 
            // --- End optional permalink handling ---

            return post; // Make sure to return the post from the map function!
        });
    }); // <-- End of addCollection function

    // Make sure htmlTemplateEngine is set correctly too
    eleventyConfig.htmlTemplateEngine = "njk";

    /**======================================================================
       PASSTHROUGHS - Copy source files to /public with no 11ty processing
    ========================================================================*/
    /** https://www.11ty.dev/docs/copy/ */

    eleventyConfig.addPassthroughCopy("./src/assets", {
        filter: [
            "**/*",
            "!**/*.js"
        ]
    });
    eleventyConfig.addPassthroughCopy("./src/admin");
    eleventyConfig.addPassthroughCopy("./src/_redirects");
    /**=====================================================================
                              END PASSTHROUGHS
    =======================================================================*/

    /**======================================================================
               FILTERS - Modify data in template files at build time
    ========================================================================*/
    /** https://www.11ty.dev/docs/filters/ */

    /**
     *  Converts dates from JSDate format (Fri Dec 02 18:00:00 GMT-0600) to a locale format.
     *  Use - {{ "DATE GOES HERE" | postDate }}
     *  https://moment.github.io/luxon/api-docs/index.html#datetime
     */
    eleventyConfig.addFilter("postDate", filterPostDate);
    /**=====================================================================
                                    END FILTERS
    =======================================================================*/

    /**======================================================================
                  SHORTCODES - Output data using JS at build time
    ========================================================================*/
    /** https://www.11ty.dev/docs/shortcodes/ */

    /**
     *  Gets the current year, which can be outputted with {% year %}. Used for the footer copyright. Updates with every build.
     *  Use - {% year %}
     */
    eleventyConfig.addShortcode("year", () => `${new Date().getFullYear()}`);
    /**=====================================================================
                                END SHORTCODES
    =======================================================================*/

    /**=====================================================================
                                SERVER SETTINGS
    =======================================================================*/
    eleventyConfig.setServerOptions(configServer);
    /**=====================================================================
                              END SERVER SETTINGS
    =======================================================================*/

    return {
        dir: {
            input: "src",
            output: "public",
            includes: "_includes",
            data: "_data",
        },
        htmlTemplateEngine: "njk",
    };
};
