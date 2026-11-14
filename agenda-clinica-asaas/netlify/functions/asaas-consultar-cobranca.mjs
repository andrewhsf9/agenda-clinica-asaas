import { asaasFetch, jsonResponse } from "./_asaas.mjs";

/**
 * Consulta o status atualizado de uma cobrança específica no Asaas.
 */
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }

  try {
    const id = event.queryStringParameters?.id;
    if (!id) {
      return jsonResponse(400, { error: "Parâmetro 'id' da cobrança é obrigatório." });
    }

    const payment = await asaasFetch(`/payments/${encodeURIComponent(id)}`);
    return jsonResponse(200, {
      ok: true,
      payment: {
        id: payment.id,
        status: payment.status,
        value: payment.value,
        dueDate: payment.dueDate,
        paymentDate: payment.paymentDate || null,
        billingType: payment.billingType,
        invoiceUrl: payment.invoiceUrl,
        bankSlipUrl: payment.bankSlipUrl || null,
      },
    });
  } catch (error) {
    return jsonResponse(error.statusCode || 500, {
      ok: false,
      error: error.message || "Erro ao consultar cobrança no Asaas.",
    });
  }
}
