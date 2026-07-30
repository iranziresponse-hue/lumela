export function normalizePhone(value) {
  return String(value || "").replace(/[^\d+]/g, "").trim();
}

export async function sha256(value) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function getOrCreateDeviceId() {
  if (typeof window === "undefined") {
    return "server";
  }

  const existing = window.localStorage.getItem("lumela.deviceId");

  if (existing) {
    return existing;
  }

  const nextId = crypto.randomUUID();
  window.localStorage.setItem("lumela.deviceId", nextId);
  return nextId;
}
