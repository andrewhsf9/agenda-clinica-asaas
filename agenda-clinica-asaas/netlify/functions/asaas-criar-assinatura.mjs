import { asaasFetch, findOrCreateCustomer, jsonResponse } from "./_asaas.mjs";

/**
 * Cria uma assinatura recorrente (plano mensal da clínica) no Asaas.
 */
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Método não permitido. Use POST." });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const {
      name,
      cpfCnpj,
      phone,
      email,
      value,
      cycle = "MONTHLY",
      billingType = "UNDEFINED",
      description = "Plano Mensal da Clínica",
      nextDueDate,
    } = body;

    if (!value || Number(value) <= 0) {
      return jsonResponse(400, { error: "Valor do plano deve ser maior que zero." });
    }

    const customer = await findOrCreateCustomer({ name, cpfCnpj, phone, email });
    const today = new Date().toISOString().slice(0, 10);

    const subscription = await asaasFetch("/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        customer: customer.id,
        billingType,
        value: Number(value),
        nextDueDate: nextDueDate || today,
        cycle,
        description,
      }),
    });

    // Busca a primeira cobrança gerada pela assinatura para disponibilizar o link imediato
    let firstPayment = null;
    try {
      const payments = await asaasFetch(`/subscriptions/${subscription.id}/payments?limit=1`);
      firstPayment = payments.data?.[0] || null;
    } catch {
      firstPayment = null;
    }

    return jsonResponse(200, {
      ok: true,
      customer: { id: customer.id, name: customer.name },
      subscription: {
        id: subscription.id,
        status: subscription.status,
        value: subscription.value,
        cycle: subscription.cycle,
        nextDueDate: subscription.nextDueDate,
        description: subscription.description,
      },
      firstPayment: firstPayment
        ? {
            id: firstPayment.id,
            status: firstPayment.status,
            invoiceUrl: firstPayment.invoiceUrl,
          }
        : null,
    });
  } catch (error) {
    return jsonResponse(error.statusCode || 500, {
      ok: false,
      error: error.message || "Erro ao criar assinatura no Asaas.",
    });
  }
}
