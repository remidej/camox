import { installLocalhostDns } from "./local-dns";

const CAMOX_API_URL = process.env.CAMOX_API_URL || "https://api.camox.ai";
installLocalhostDns(new URL(CAMOX_API_URL).hostname);

// --- Session validation ---

export async function verifySession(token: string): Promise<boolean> {
  const res = await fetch(`${CAMOX_API_URL}/api/auth/get-session`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  return res.ok;
}
