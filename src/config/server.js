module.exports = {
    // Fixes an issue where the dev website breaks when making JS changes
    watch: ["public/assets/js/*.js"],

    // TEMPLATE: change to this site's port block from the TCT dev port list (Notion)
    // before first `npm start`. Sites use 81x0 for Eleventy, 81x1 for decap-server.
    // Retry count 0 = fail loudly on a clash instead of silently moving ports.
    port: 8080,
    portReassignmentRetryCount: 0,

    // An accessible variable to determine if the server is in production mode or not
    isProduction: process.env.ELEVENTY_ENV === "PROD",
};
