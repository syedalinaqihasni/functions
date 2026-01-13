// functions/corsConfig.js
const cors = require("cors");

// Change `true` to your allowed origin list for production
module.exports = cors({ origin: true });
