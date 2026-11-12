import crypto from "node:crypto";

export function requestId(req, res, next) {
  req.id = crypto.randomUUID();
  res.set("X-Request-Id", req.id);
  next();
}

export function sendError(req, res, status, code, message, details) {
  return res.status(status).json({
    error: message,
    code,
    requestId: req.id,
    ...(details ? { details } : {}),
  });
}

export function logSafeError(req, error) {
  // Avoid writing request bodies, phone numbers, SQL parameters, or provider messages to logs.
  process.stderr.write(
    `${JSON.stringify({ level: "error", requestId: req.id, path: req.path, code: error.code || error.name || "unexpected_error" })}\n`,
  );
}
