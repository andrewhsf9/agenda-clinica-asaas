import { asaasFetch, findOrCreateCustomer, jsonResponse } from "./_asaas.mjs";

/**
 * Cria uma assinatura recorrente (plano da clínica) no Asaas com prazo de vencimento
 * (nextDueDate para a 1ª cobrança e endDate opcional para o fim/validade do plano).
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
      endDate,
    } = body;

    if (!value || Number(value) <= 0) {
      return jsonResponse(400, { error: "Valor do plano deve ser maior que zero." });
    }

    const customer = await findOrCreateCustomer({ name, cpfCnpj, phone, email });
    const today = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const subPayload = {
      customer: customer.id,
      billingType,
      value: Number(value),
      nextDueDate: nextDueDate || today,
      cycle,
      description,
    };

    if (endDate) {
      subPayload.endDate = endDate;
    }

    const subscription = await asaasFetch("/subscriptions", {
      method: "POST",
      body: JSON.stringify(subPayload),
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
        endDate: subscription.endDate || null,
        description: subscription.description,
      },
      firstPayment: firstPayment
        ? {
            id: firstPayment.id,
            status: firstPayment.status,
            dueDate: firstPayment.dueDate,
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
