import { getStore } from "@netlify/blobs";
import { jsonResponse } from "./_asaas.mjs";

/**
 * Lista os últimos eventos recebidos via Webhook do Asaas.
 */
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }

  try {
    const store = getStore("asaas-webhooks");
    const events = (await store.get("recent-events", { type: "json" })) || [];
    return jsonResponse(200, {
      ok: true,
      env: process.env.ASAAS_ENV || "sandbox",
      configured: Boolean(process.env.ASAAS_API_KEY),
      events,
    });
  } catch {
    return jsonResponse(200, {
      ok: true,
      env: process.env.ASAAS_ENV || "sandbox",
      configured: Boolean(process.env.ASAAS_API_KEY),
      events: [],
    });
  }
}
