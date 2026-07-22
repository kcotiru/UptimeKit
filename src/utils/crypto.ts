import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const ENCRYPTION_KEY = Buffer.from((process.env.ENCRYPTION_KEY || "01234567890123456789012345678901").slice(0, 32));

export function encryptConfig(config: Record<string, any>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  const jsonStr = JSON.stringify(config);
  let encrypted = cipher.update(jsonStr, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return JSON.stringify({
    iv: iv.toString("hex"),
    encrypted,
    tag: authTag,
  });
}

export function decryptConfig(encryptedData: any): Record<string, any> {
  if (typeof encryptedData === "object" && !encryptedData.encrypted) {
    return encryptedData;
  }
  const parsed = typeof encryptedData === "string" ? JSON.parse(encryptedData) : encryptedData;
  if (!parsed.iv || !parsed.encrypted || !parsed.tag) {
    return parsed;
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    ENCRYPTION_KEY,
    Buffer.from(parsed.iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(parsed.tag, "hex"));
  let decrypted = decipher.update(parsed.encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return JSON.parse(decrypted);
}
