import { getStore } from "@netlify/blobs";
import { jsonResponse } from "./_asaas.mjs";

/**
 * Recebe notificações (Webhooks) do Asaas:
 * PAYMENT_CONFIRMED, PAYMENT_RECEIVED, PAYMENT_OVERDUE, SUBSCRIPTION_INACTIVATED, etc.
 * Valida o token via header "asaas-access-token" e registra o evento no Netlify Blobs.
 */
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Método não permitido." });
  }

  const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN;
  if (expectedToken) {
    const receivedToken =
      event.headers["asaas-access-token"] || event.headers["Asaas-Access-Token"];
    if (receivedToken !== expectedToken) {
      return jsonResponse(401, { error: "Token de webhook inválido." });
    }
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const eventType = payload.event || "UNKNOWN";
    const payment = payload.payment || null;
    const subscription = payload.subscription || null;

    const record = {
      event: eventType,
      receivedAt: new Date().toISOString(),
      paymentId: payment?.id || null,
      paymentStatus: payment?.status || null,
      externalReference: payment?.externalReference || null,
      value: payment?.value || null,
      subscriptionId: subscription?.id || null,
      subscriptionStatus: subscription?.status || null,
    };

    try {
      const store = getStore("asaas-webhooks");
      if (record.paymentId) {
        await store.setJSON(`payment:${record.paymentId}`, record);
      }
      const log = (await store.get("recent-events", { type: "json" })) || [];
      log.unshift(record);
      await store.setJSON("recent-events", log.slice(0, 50));
    } catch {
      // Caso rode fora do ambiente Netlify Blobs, apenas confirma o recebimento 200 OK.
    }

    return jsonResponse(200, { received: true, event: eventType });
  } catch (error) {
    return jsonResponse(400, { error: "Payload inválido.", details: error.message });
  }
}
