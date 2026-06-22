const env = require("../config/env");

// 404 handler
const notFound = (req, res, next) => {
  res.status(404).json({ error: "Not found", path: req.originalUrl });
};

// Central error handler
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error("[error]", err);
  res.status(status).json({
    error: err.message || "Internal Server Error",
    ...(env.isProd ? {} : { stack: err.stack }),
  });
};

module.exports = { notFound, errorHandler };
