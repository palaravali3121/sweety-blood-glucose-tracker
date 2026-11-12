import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { sendError } from "./http.js";

export function secret() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)
    throw new Error("JWT_SECRET must contain at least 32 characters");
  return process.env.JWT_SECRET;
}
export const makeToken = (user) =>
  jwt.sign({ sub: String(user.id), name: user.name }, secret(), {
    expiresIn: "7d",
  });
export async function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  if (!header.startsWith("Bearer "))
    return sendError(req, res, 401, "AUTH_REQUIRED", "Please log in.");
  try {
    req.user = jwt.verify(header.slice(7), secret());
    return next();
  } catch {
    return sendError(
      req,
      res,
      401,
      "INVALID_TOKEN",
      "Your session is invalid or expired. Please log in again.",
    );
  }
}
export const hashPassword = (value) => bcrypt.hash(value, 12);
export const verifyPassword = (value, hash) => bcrypt.compare(value, hash);
