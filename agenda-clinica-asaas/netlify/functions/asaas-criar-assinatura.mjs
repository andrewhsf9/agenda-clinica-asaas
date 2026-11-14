import { getStore } from "@netlify/blobs";
import {
  ASAAS_BILLING_RULES,
  addMonthsIso,
  addYearsIso,
  asaasFetch,
  checkQuarantineBlock,
  findOrCreateCustomer,
  formatDateBr,
  getTodayBrazilIso,
  jsonResponse,
  sanitizeCpfCnpj,
} from "./_asaas.mjs";

/**
 * Cria assinatura no Asaas:
 * - A 1ª mensalidade + Taxa de Adesão (R$ 10,00) é paga no ato do contrato.
 * - As mensalidades recorrentes no Asaas começam a partir do mês seguinte (nextDueDate = +1 mês).
 * - Boletos do Asaas já saem com 5% de desconto até o vencimento e 2% de multa + 2% de juros após o vencimento.
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
      planId,
      planCategory = "TABELA",
      value,
      taxaAdesao = 10.0,
      cycle = "MONTHLY",
      billingType = "BOLETO",
      description = "Plano Mensal da Clínica",
      nextDueDate,
      endDate,
      dataAdesao,
      dependentes = [],
      masterOverride = false,
    } = body;

    const valorMensal = Number(value);
    const valorAdesao = Number(taxaAdesao || 0);
    const valorPagoNoAto = Number((valorMensal + valorAdesao).toFixed(2));
    const today = getTodayBrazilIso();
    const adesaoIso = dataAdesao || today;
    // As mensalidades do Asaas começam a partir do mês seguinte ao ato do contrato
    const vencimentoMesSeguinte = nextDueDate || addMonthsIso(adesaoIso, 1);

    if (!valorMensal || valorMensal <= 0) {
      return jsonResponse(400, { error: "Informe um valor mensal válido maior que zero." });
    }

    const store = getStore("clinica-planos-db");
    let historicoSaidas = [];
    try {
      historicoSaidas = (await store.get("historico-saidas", { type: "json" })) || [];
    } catch {
      historicoSaidas = [];
    }

    // 1. Verifica bloqueio de 6 meses para quem saiu ou cancelou o plano (a menos que liberado com Acesso Master)
    if (!masterOverride) {
      const bloqueioTitular = checkQuarantineBlock(historicoSaidas, cpfCnpj, today);
      if (bloqueioTitular) {
        return jsonResponse(403, {
          ok: false,
          bloqueioQuarentena: true,
          error: `🚫 Bloqueio de 6 meses: o titular ${bloqueioTitular.nome} (CPF ${bloqueioTitular.cpf}) saiu/cancelou o plano em ${formatDateBr(bloqueioTitular.dataSaida)} e não pode reativar ou entrar em outro plano até ${formatDateBr(bloqueioTitular.bloqueadoAte)} (${bloqueioTitular.motivo}). O responsável do setor pode liberar com Acesso Master.`,
        });
      }

      for (const dep of dependentes || []) {
        if (dep?.cpf) {
          const bloqueioDep = checkQuarantineBlock(historicoSaidas, dep.cpf, today);
          if (bloqueioDep) {
            return jsonResponse(403, {
              ok: false,
              bloqueioQuarentena: true,
              error: `🚫 Bloqueio de 6 meses: o dependente ${dep.nome} (CPF ${bloqueioDep.cpf}) saiu/cancelou um plano em ${formatDateBr(bloqueioDep.dataSaida)} e está impedido de entrar em outro plano até ${formatDateBr(bloqueioDep.bloqueadoAte)}. O responsável do setor pode liberar com Acesso Master.`,
            });
          }
        }
      }
    }

    const customer = await findOrCreateCustomer({ name, cpfCnpj, phone, email });

    const subPayload = {
      customer: customer.id,
      billingType,
      value: valorMensal,
      nextDueDate: vencimentoMesSeguinte,
      cycle,
      description,
      ...ASAAS_BILLING_RULES,
    };

    if (endDate) {
      subPayload.endDate = endDate;
    }

    const subscription = await asaasFetch("/subscriptions", {
      method: "POST",
      body: JSON.stringify(subPayload),
    });

    // Busca o 1º boleto gerado no Asaas (referente ao mês seguinte) para já ter o link disponível
    let firstPayment = null;
    try {
      const payments = await asaasFetch(`/subscriptions/${subscription.id}/payments?limit=1`);
      firstPayment = payments.data?.[0] || null;
    } catch {
      firstPayment = null;
    }

    const cleanDependentes = (Array.isArray(dependentes) ? dependentes : [])
      .filter((d) => d && d.nome && String(d.nome).trim())
      .map((d, idx) => ({
        id: d.id || `dep-${Date.now()}-${idx}`,
        nome: String(d.nome).trim(),
        cpf: sanitizeCpfCnpj(d.cpf),
        parentesco: String(d.parentesco || "Dependente").trim(),
        dataInclusao: d.dataInclusao || adesaoIso,
        tipoInclusao: "ADESAO_INICIAL",
      }));

    const proximoReajusteEm = addYearsIso(adesaoIso, 1);

    const contrato = {
      id: subscription.id,
      subscriptionId: subscription.id,
      customerId: customer.id,
      titularNome: customer.name || name,
      titularCpf: sanitizeCpfCnpj(cpfCnpj),
      titularPhone: sanitizeCpfCnpj(phone),
      planId: planId || "personalizado",
      planCategory,
      planName: description,
      valorMensal,
      taxaAdesaoInicial: valorAdesao,
      valorPagoNoAto,
      primeiraMensalidadePagaNoAto: true,
      billingType,
      nextDueDate: subscription.nextDueDate || vencimentoMesSeguinte,
      endDate: subscription.endDate || endDate || null,
      createdAt: adesaoIso,
      proximoReajusteEm,
      ultimoReajusteEm: null,
      carenciasPersonalizadas: null,
      status: subscription.status || "ACTIVE",
      firstPaymentUrl: firstPayment?.bankSlipUrl || firstPayment?.invoiceUrl || null,
      firstPaymentInvoiceUrl: firstPayment?.invoiceUrl || null,
      firstPaymentValue: firstPayment?.value || valorMensal,
      dependentes: cleanDependentes,
      historicoEventos: [
        {
          data: today,
          tipo: "ADESAO",
          descricao: `Contrato firmado em ${formatDateBr(adesaoIso)} (${1 + cleanDependentes.length} vida(s)). Pago no ato: R$ ${valorPagoNoAto.toFixed(2)} (1ª mensalidade R$ ${valorMensal.toFixed(2)} + R$ ${valorAdesao.toFixed(2)} adesão). Mensalidades Asaas (R$ ${valorMensal.toFixed(2)}/mês) iniciam em ${formatDateBr(vencimentoMesSeguinte)}. Reajuste anual (+5%) em ${formatDateBr(proximoReajusteEm)}.${masterOverride ? " [Liberado via Acesso Master]" : ""}`,
        },
      ],
    };

    try {
      const contratos = (await store.get("contratos", { type: "json" })) || [];
      const filtrados = contratos.filter((c) => c.subscriptionId !== contrato.subscriptionId);
      filtrados.unshift(contrato);
      await store.setJSON("contratos", filtrados);
    } catch {
      // Fallback caso rode fora do Netlify Blobs
    }

    return jsonResponse(200, {
      ok: true,
      contrato,
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
            value: firstPayment.value,
            dueDate: firstPayment.dueDate,
            invoiceUrl: firstPayment.invoiceUrl,
            bankSlipUrl: firstPayment.bankSlipUrl || null,
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
