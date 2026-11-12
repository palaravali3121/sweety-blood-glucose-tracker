export function loadConfig(env = process.env) {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!/^postgres(ql)?:\/\//.test(databaseUrl))
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL");

  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret || Buffer.byteLength(jwtSecret, "utf8") < 32) {
    throw new Error("JWT_SECRET must contain at least 32 bytes");
  }

  const port = Number(env.PORT || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be an integer from 1 to 65535");

  const trustProxyHops = Number(env.TRUST_PROXY_HOPS || 0);
  if (
    !Number.isInteger(trustProxyHops) ||
    trustProxyHops < 0 ||
    trustProxyHops > 5
  ) {
    throw new Error("TRUST_PROXY_HOPS must be an integer from 0 to 5");
  }

  const clientOrigin = env.CLIENT_ORIGIN || "http://localhost:5173";
  let origin;
  try {
    origin = new URL(clientOrigin);
  } catch {
    throw new Error("CLIENT_ORIGIN must be a valid URL");
  }
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.origin !== clientOrigin.replace(/\/$/, "")
  ) {
    throw new Error(
      "CLIENT_ORIGIN must be one exact http or https origin without a path",
    );
  }

  const smsValues = [
    env.TWILIO_ACCOUNT_SID,
    env.TWILIO_AUTH_TOKEN,
    env.TWILIO_PHONE_NUMBER,
  ];
  if (smsValues.some(Boolean) && !smsValues.every(Boolean)) {
    throw new Error("Set all three Twilio variables or leave all three blank");
  }
  const webOtpDomain = env.WEBOTP_DOMAIN || "localhost";
  if (!/^(localhost|[a-z0-9.-]+)$/i.test(webOtpDomain))
    throw new Error(
      "WEBOTP_DOMAIN must be a domain name without scheme, path, or port",
    );

  return {
    port,
    trustProxyHops,
    databaseUrl,
    jwtSecret,
    clientOrigin: origin.origin,
    smsEnabled: smsValues.every(Boolean),
    twilioAccountSid: env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: env.TWILIO_AUTH_TOKEN,
    twilioPhoneNumber: env.TWILIO_PHONE_NUMBER,
    webOtpDomain,
  };
}
