import { Router } from "express";
import { google } from "googleapis";
import { prisma } from "../lib/prisma.js";
import { encrypt } from "../lib/encryption.js";
import { logger } from "../lib/logger.js";

const router = Router();

function getRedirectUri(origin?: string) {
  if (origin) {
    try {
      const u = new URL(origin);
      return `${u.origin}/auth/callback`;
    } catch {}
  }
  return `${process.env.FRONTEND_URL || "http://localhost:5173"}/auth/callback`;
}

function getOAuth2Client(redirectUri: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env");
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

router.get("/google/url", (req, res) => {
  try {
    const origin = req.query.origin as string | undefined;
    const redirectUri = getRedirectUri(origin);
    const oauth2Client = getOAuth2Client(redirectUri);
    const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/userinfo.email"],
    prompt: "consent",
    });
    res.json({ url });
  } catch (e) {
    logger.error("Google OAuth URL error", e);
    res.status(500).json({ error: (e as Error).message });
  }
});

router.post("/google/callback", async (req, res) => {
  try {
    const { code, accountId, redirectUri } = req.body;
    if (!code) return res.status(400).json({ error: "code required" });

    const uri = getRedirectUri(redirectUri);
    const oauth2Client = getOAuth2Client(uri);
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();
    const email = data.email?.toLowerCase();
    if (!email) return res.status(400).json({ error: "Could not get email" });

    if (accountId) {
      await prisma.emailAccount.update({
        where: { id: accountId },
        data: {
          email,
          accountType: "google",
          oauthTokens: encrypt(JSON.stringify(tokens)),
        },
      });
      return res.json({ success: true, accountId, email });
    }

    const existing = await prisma.emailAccount.findUnique({ where: { email } });
    if (existing) {
      await prisma.emailAccount.update({
        where: { id: existing.id },
        data: { oauthTokens: encrypt(JSON.stringify(tokens)) },
      });
      return res.json({ success: true, accountId: existing.id, email });
    }

    const account = await prisma.emailAccount.create({
      data: {
        email,
        accountType: "google",
        oauthTokens: encrypt(JSON.stringify(tokens)),
      },
    });
    res.json({ success: true, accountId: account.id, email });
  } catch (e) {
    logger.error("Google callback error", e);
    res.status(500).json({ error: "Failed to connect Google account" });
  }
});

export { router as authRouter };
