import { decrypt } from "./encryption.js";

export function getDecryptedPassword(account: { smtpPasswordEncrypted: string | null }): string | null {
  if (!account.smtpPasswordEncrypted) return null;
  try {
    return decrypt(account.smtpPasswordEncrypted);
  } catch {
    return null;
  }
}

export function getDecryptedOAuth(account: { oauthTokens: string | null }): Record<string, unknown> | null {
  if (!account.oauthTokens) return null;
  try {
    return JSON.parse(decrypt(account.oauthTokens)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
