import { ASAAS_BILLING_RULES, asaasFetch, findOrCreateCustomer, jsonResponse } from "./_asaas.mjs";

/**
 * Cria uma cobrança avulsa no Asaas (PIX, BOLETO, CREDIT_CARD ou UNDEFINED para link de pagamento)
 * já configurada com 5% de desconto até o vencimento, 2% de multa e 2% de juros após o vencimento.
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
      dueDate,
      billingType = "BOLETO",
      description = "Consulta Particular - Clínica",
      externalReference,
      applyDiscountAndFine = true,
    } = body;

    if (!value || Number(value) <= 0) {
      return jsonResponse(400, { error: "Valor da cobrança deve ser maior que zero." });
    }

    const customer = await findOrCreateCustomer({ name, cpfCnpj, phone, email });

    const today = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const paymentPayload = {
      customer: customer.id,
      billingType,
      value: Number(value),
      dueDate: dueDate || today,
      description,
      externalReference: externalReference || undefined,
      ...(applyDiscountAndFine ? ASAAS_BILLING_RULES : {}),
    };

    const payment = await asaasFetch("/payments", {
      method: "POST",
      body: JSON.stringify(paymentPayload),
    });

    let pix = null;
    if (billingType === "PIX") {
      try {
        pix = await asaasFetch(`/payments/${payment.id}/pixQrCode`);
      } catch {
        pix = null;
      }
    }

    return jsonResponse(200, {
      ok: true,
      customer: { id: customer.id, name: customer.name },
      payment: {
        id: payment.id,
        status: payment.status,
        value: payment.value,
        dueDate: payment.dueDate,
        billingType: payment.billingType,
        invoiceUrl: payment.invoiceUrl,
        bankSlipUrl: payment.bankSlipUrl || null,
      },
      pix: pix
        ? {
            encodedImage: pix.encodedImage,
            payload: pix.payload,
            expirationDate: pix.expirationDate,
          }
        : null,
    });
  } catch (error) {
    return jsonResponse(error.statusCode || 500, {
      ok: false,
      error: error.message || "Erro ao criar cobrança no Asaas.",
    });
  }
}
