import { asaasFetch, jsonResponse, sanitizeCpfCnpj } from "./_asaas.mjs";

/**
 * Verifica no Asaas se o paciente possui plano (assinatura) ativo e em dia.
 * Se houver faturas vencidas (OVERDUE) ou nenhuma assinatura ACTIVE, recusa e informa o motivo.
 */
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }

  try {
    const cpf = sanitizeCpfCnpj(event.queryStringParameters?.cpf);
    if (!cpf || (cpf.length !== 11 && cpf.length !== 14)) {
      return jsonResponse(400, {
        autorizado: false,
        statusPlano: "CPF_INVALIDO",
        motivo: "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.",
      });
    }

    const customersRes = await asaasFetch(`/customers?cpfCnpj=${encodeURIComponent(cpf)}`);
    const customer = customersRes.data?.[0];

    if (!customer) {
      return jsonResponse(200, {
        autorizado: false,
        statusPlano: "NAO_ENCONTRADO",
        motivo: "Paciente não encontrado no Asaas. Não possui plano ativo — agende como Particular ou faça a adesão ao plano.",
      });
    }

    const [subsRes, overdueRes] = await Promise.all([
      asaasFetch(`/subscriptions?customer=${encodeURIComponent(customer.id)}&limit=20`),
      asaasFetch(`/payments?customer=${encodeURIComponent(customer.id)}&status=OVERDUE&limit=20`),
    ]);

    const subscriptions = subsRes.data || [];
    const overduePayments = overdueRes.data || [];

    if (overduePayments.length > 0) {
      const totalVencido = overduePayments.reduce((acc, p) => acc + Number(p.value || 0), 0);
      const maisAntiga = overduePayments[overduePayments.length - 1];
      return jsonResponse(200, {
        autorizado: false,
        statusPlano: "INADIMPLENTE",
        motivo: `Agendamento recusado: paciente possui ${overduePayments.length} fatura(s) vencida(s) no Asaas (total R$ ${totalVencido.toFixed(2).replace(".", ",")}, vencimento mais antigo em ${maisAntiga.dueDate}).`,
        customer: { id: customer.id, name: customer.name, cpfCnpj: customer.cpfCnpj },
        faturasVencidas: overduePayments.map((p) => ({
          id: p.id,
          value: p.value,
          dueDate: p.dueDate,
          invoiceUrl: p.invoiceUrl,
          billingType: p.billingType,
        })),
        linkRegularizacao: maisAntiga.invoiceUrl || null,
      });
    }

    const activeSub = subscriptions.find((s) => s.status === "ACTIVE");
    if (!activeSub) {
      const ultimaSub = subscriptions[0];
      const motivoDetalhe = ultimaSub
        ? `A assinatura anterior encontra-se com status "${ultimaSub.status}".`
        : "Nenhuma assinatura de plano encontrada para este CPF.";
      return jsonResponse(200, {
        autorizado: false,
        statusPlano: "SEM_PLANO_ATIVO",
        motivo: `Agendamento pelo plano recusado: ${motivoDetalhe}`,
        customer: { id: customer.id, name: customer.name, cpfCnpj: customer.cpfCnpj },
      });
    }

    return jsonResponse(200, {
      autorizado: true,
      statusPlano: "EM_DIA",
      motivo: `Plano em dia! Assinatura "${activeSub.description || "Plano Clínica"}" ativa (próximo vencimento: ${activeSub.nextDueDate}).`,
      customer: { id: customer.id, name: customer.name, cpfCnpj: customer.cpfCnpj },
      plano: {
        id: activeSub.id,
        description: activeSub.description || "Plano Mensal da Clínica",
        value: activeSub.value,
        cycle: activeSub.cycle,
        nextDueDate: activeSub.nextDueDate,
        status: activeSub.status,
      },
    });
  } catch (error) {
    return jsonResponse(error.statusCode || 500, {
      autorizado: false,
      statusPlano: "ERRO_API",
      motivo: error.message || "Erro ao consultar o Asaas.",
    });
  }
}
