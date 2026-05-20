const serverless = require('serverless-http');
const app = require('./news');
exports.handler = serverless(app);
