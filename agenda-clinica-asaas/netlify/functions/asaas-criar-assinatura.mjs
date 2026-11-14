import { getStore } from "@netlify/blobs";
import {
  ASAAS_BILLING_RULES,
  addMonthsIso,
  addYearsIso,
  asaasFetch,
  checkQuarantineBlock,
  findOrCreateCustomer,
  formatDateBr,
  generateMatricula,
  getTodayBrazilIso,
  isValidCpf,
  jsonResponse,
  sanitizeCpfCnpj,
} from "./_asaas.mjs";

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
      matricula: inputMatricula,
      name,
      cpfCnpj,
      dataNascimento,
      phone,
      email,
      endereco = {},
      planId,
      planCategory = "TABELA",
      vidasContratadas,
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

    if (!isValidCpf(cpfCnpj)) {
      return jsonResponse(400, {
        ok: false,
        error: `CPF do titular (${cpfCnpj || "vazio"}) é inválido. Verifique os dígitos informados.`,
      });
    }

    if (!dataNascimento) {
      return jsonResponse(400, {
        ok: false,
        error: "Informe a data de nascimento do titular.",
      });
    }

    if (!endereco?.cep || !endereco?.logradouro) {
      return jsonResponse(400, {
        ok: false,
        error: "Informe o endereço completo com CEP do titular.",
      });
    }

    const cleanDepsInput = (Array.isArray(dependentes) ? dependentes : []).filter(
      (d) => d && (d.nome || d.cpf || d.dataNascimento)
    );

    for (const dep of cleanDepsInput) {
      if (!dep.nome || !String(dep.nome).trim()) {
        return jsonResponse(400, { ok: false, error: "Preencha o nome completo de todos os dependentes informados." });
      }
      if (!isValidCpf(dep.cpf)) {
        return jsonResponse(400, {
          ok: false,
          error: `CPF inválido para o dependente "${dep.nome}" (${dep.cpf || "vazio"}).`,
        });
      }
      if (!dep.dataNascimento) {
        return jsonResponse(400, {
          ok: false,
          error: `Informe a data de nascimento do dependente "${dep.nome}".`,
        });
      }
    }

    const valorMensal = Number(value);
    const valorAdesao = Number(taxaAdesao || 0);
    const valorPagoNoAto = Number((valorMensal + valorAdesao).toFixed(2));
    const today = getTodayBrazilIso();
    const adesaoIso = dataAdesao || today;
    const vencimentoMesSeguinte = nextDueDate || addMonthsIso(adesaoIso, 1);

    if (!valorMensal || valorMensal <= 0) {
      return jsonResponse(400, { error: "Informe um valor mensal válido maior que zero." });
    }

    const store = getStore("clinica-planos-db");
    let historicoSaidas = [];
    let contratos = [];
    try {
      [historicoSaidas, contratos] = await Promise.all([
        store.get("historico-saidas", { type: "json" }).then((r) => r || []),
        store.get("contratos", { type: "json" }).then((r) => r || []),
      ]);
    } catch {
      historicoSaidas = [];
      contratos = [];
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

      for (const dep of cleanDepsInput) {
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

    const matricula = inputMatricula || generateMatricula(contratos.length);

    const customer = await findOrCreateCustomer({
      name,
      cpfCnpj,
      phone,
      email,
      endereco,
      externalReference: matricula,
    });

    const subPayload = {
      customer: customer.id,
      billingType,
      value: valorMensal,
      nextDueDate: vencimentoMesSeguinte,
      cycle,
      description: `[${matricula}] ${description}`,
      externalReference: matricula,
      ...ASAAS_BILLING_RULES,
    };

    if (endDate) {
      subPayload.endDate = endDate;
    }

    const subscription = await asaasFetch("/subscriptions", {
      method: "POST",
      body: JSON.stringify(subPayload),
    });

    let firstPayment = null;
    try {
      const payments = await asaasFetch(`/subscriptions/${subscription.id}/payments?limit=1`);
      firstPayment = payments.data?.[0] || null;
    } catch {
      firstPayment = null;
    }

    const cleanDependentes = cleanDepsInput.map((d, idx) => ({
      id: d.id || `dep-${Date.now()}-${idx}`,
      nome: String(d.nome).trim(),
      cpf: sanitizeCpfCnpj(d.cpf),
      dataNascimento: d.dataNascimento || null,
      parentesco: String(d.parentesco || "Dependente").trim(),
      dataInclusao: d.dataInclusao || adesaoIso,
      tipoInclusao: "ADESAO_INICIAL",
    }));

    const proximoReajusteEm = addYearsIso(adesaoIso, 1);
    const totalVidas = Math.max(Number(vidasContratadas || 1), 1 + cleanDependentes.length);

    const contrato = {
      id: subscription.id,
      matricula,
      subscriptionId: subscription.id,
      customerId: customer.id,
      titularNome: customer.name || name,
      titularCpf: sanitizeCpfCnpj(cpfCnpj),
      titularDataNascimento: dataNascimento,
      titularPhone: sanitizeCpfCnpj(phone),
      endereco: {
        cep: sanitizeCpfCnpj(endereco.cep),
        logradouro: endereco.logradouro || "",
        numero: endereco.numero || "",
        complemento: endereco.complemento || "",
        bairro: endereco.bairro || "",
        cidade: endereco.cidade || "",
        uf: endereco.uf || "",
      },
      planId: planId || "personalizado",
      planCategory,
      vidasContratadas: totalVidas,
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
          descricao: `Matrícula ${matricula} firmada em ${formatDateBr(adesaoIso)} (${totalVidas} vida(s)). Pago no ato: R$ ${valorPagoNoAto.toFixed(2)} (1ª mensalidade R$ ${valorMensal.toFixed(2)} + R$ ${valorAdesao.toFixed(2)} adesão). Mensalidades Asaas (R$ ${valorMensal.toFixed(2)}/mês) iniciam em ${formatDateBr(vencimentoMesSeguinte)}.${masterOverride ? " [Liberado via Acesso Master]" : ""}`,
        },
      ],
    };

    try {
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
