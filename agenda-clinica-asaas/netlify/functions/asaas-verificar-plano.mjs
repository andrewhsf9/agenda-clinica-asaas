import { asaasFetch, jsonResponse, sanitizeCpfCnpj } from "./_asaas.mjs";

function formatDateBr(isoDate) {
  if (!isoDate) return "-";
  const [y, m, d] = String(isoDate).split("-");
  return d && m && y ? `${d}/${m}/${y}` : isoDate;
}

function getTodayBrazilIso() {
  // Fuso horário de Brasília (UTC-3)
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

const PAID_STATUSES = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH", "DUNNING_RECEIVED"]);

/**
 * Verifica no Asaas se o paciente possui plano (assinatura) ativo E com pagamento realmente confirmado.
 * Regras para aprovar (autorizado = true):
 * 1. Possuir assinatura ACTIVE (e dentro da data de validade endDate, se houver).
 * 2. Não possuir nenhuma cobrança OVERDUE nem cobrança PENDING com vencimento já passado (dueDate < hoje).
 * 3. Possuir pelo menos uma cobrança efetivamente PAGA (RECEIVED / CONFIRMED / RECEIVED_IN_CASH)
 *    e não ter cobrança PENDING vencendo hoje ou no passado sem pagamento.
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

    const customersRes = await asaasFetch(`/customers?cpfCnpj=${encodeURIComponent(cpf)}&limit=10`);
    const customers = customersRes.data || [];

    if (customers.length === 0) {
      return jsonResponse(200, {
        autorizado: false,
        statusPlano: "NAO_ENCONTRADO",
        motivo: "Paciente não encontrado no Asaas. Não possui plano ativo — agende como Particular ou faça a adesão ao plano.",
      });
    }

    const primaryCustomer = customers[0];
    const today = getTodayBrazilIso();

    // Busca assinaturas e cobranças de todos os cadastros vinculados a este CPF no Asaas
    const allSubscriptions = [];
    const allPayments = [];

    await Promise.all(
      customers.map(async (cust) => {
        const [subsRes, paysRes] = await Promise.all([
          asaasFetch(`/subscriptions?customer=${encodeURIComponent(cust.id)}&limit=50`),
          asaasFetch(`/payments?customer=${encodeURIComponent(cust.id)}&limit=50`),
        ]);
        if (subsRes.data) allSubscriptions.push(...subsRes.data);
        if (paysRes.data) allPayments.push(...paysRes.data);
      })
    );

    // 1. Verifica faturas vencidas (status OVERDUE ou status PENDING com dueDate < hoje)
    const overduePayments = allPayments.filter(
      (p) => p.status === "OVERDUE" || (p.status === "PENDING" && p.dueDate && p.dueDate < today)
    );

    if (overduePayments.length > 0) {
      const totalVencido = overduePayments.reduce((acc, p) => acc + Number(p.value || 0), 0);
      const maisAntiga = overduePayments[overduePayments.length - 1];
      return jsonResponse(200, {
        autorizado: false,
        statusPlano: "INADIMPLENTE",
        motivo: `Agendamento recusado: paciente possui ${overduePayments.length} fatura(s) vencida(s) em aberto no Asaas (total R$ ${totalVencido.toFixed(2).replace(".", ",")}, vencimento em ${formatDateBr(maisAntiga.dueDate)}).`,
        customer: { id: primaryCustomer.id, name: primaryCustomer.name, cpfCnpj: primaryCustomer.cpfCnpj },
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

    // 2. Verifica se existe assinatura ACTIVE e dentro do prazo de validade (endDate)
    const activeSub = allSubscriptions.find(
      (s) => s.status === "ACTIVE" && (!s.endDate || s.endDate >= today)
    );

    if (!activeSub) {
      const ultimaSub = allSubscriptions[0];
      let motivoDetalhe = "Nenhuma assinatura de plano encontrada para este CPF.";
      if (ultimaSub) {
        if (ultimaSub.endDate && ultimaSub.endDate < today) {
          motivoDetalhe = `O prazo de validade da assinatura expirou em ${formatDateBr(ultimaSub.endDate)}.`;
        } else {
          motivoDetalhe = `A assinatura encontra-se com status "${ultimaSub.status}".`;
        }
      }
      return jsonResponse(200, {
        autorizado: false,
        statusPlano: "SEM_PLANO_ATIVO",
        motivo: `Agendamento pelo plano recusado: ${motivoDetalhe}`,
        customer: { id: primaryCustomer.id, name: primaryCustomer.name, cpfCnpj: primaryCustomer.cpfCnpj },
      });
    }

    // 3. Verifica as cobranças da assinatura ativa para confirmar se o cliente REALMENTE PAGOU
    const subPayments = allPayments.filter((p) => p.subscription === activeSub.id);
    const paymentsToCheck = subPayments.length > 0 ? subPayments : allPayments;

    const paidPayments = paymentsToCheck.filter((p) => PAID_STATUSES.has(p.status));
    const pendingPayments = paymentsToCheck.filter((p) => p.status === "PENDING");

    // Se nunca pagou nenhuma mensalidade (ex.: acabou de criar a assinatura e a 1ª fatura ainda está PENDING)
    // OU se existe fatura PENDING vencendo hoje ainda não paga:
    const pendingDueToday = pendingPayments.find((p) => p.dueDate && p.dueDate <= today);

    if (paidPayments.length === 0 || pendingDueToday) {
      const pendente = pendingDueToday || pendingPayments[0];
      const detalheFatura = pendente
        ? `A fatura de R$ ${Number(pendente.value || activeSub.value).toFixed(2).replace(".", ",")} (vencimento ${formatDateBr(pendente.dueDate)}) ainda consta como PENDENTE (aguardando pagamento) no Asaas.`
        : "Nenhuma mensalidade paga foi encontrada para esta assinatura no Asaas.";

      return jsonResponse(200, {
        autorizado: false,
        statusPlano: "AGUARDANDO_PAGAMENTO",
        motivo: `Agendamento recusado: o plano foi cadastrado, mas ainda NÃO consta pagamento confirmado. ${detalheFatura}`,
        customer: { id: primaryCustomer.id, name: primaryCustomer.name, cpfCnpj: primaryCustomer.cpfCnpj },
        linkRegularizacao: pendente?.invoiceUrl || null,
      });
    }

    const ultimoPago = paidPayments[0];

    return jsonResponse(200, {
      autorizado: true,
      statusPlano: "EM_DIA",
      motivo: `Plano em dia! Pagamento confirmado no Asaas (última fatura paga: R$ ${Number(ultimoPago.value).toFixed(2).replace(".", ",")} • próximo vencimento: ${formatDateBr(activeSub.nextDueDate)}${activeSub.endDate ? ` • validade do plano até ${formatDateBr(activeSub.endDate)}` : ""}).`,
      customer: { id: primaryCustomer.id, name: primaryCustomer.name, cpfCnpj: primaryCustomer.cpfCnpj },
      plano: {
        id: activeSub.id,
        description: activeSub.description || "Plano Mensal da Clínica",
        value: activeSub.value,
        cycle: activeSub.cycle,
        nextDueDate: activeSub.nextDueDate,
        endDate: activeSub.endDate || null,
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
