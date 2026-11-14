import { getStore } from "@netlify/blobs";
import {
  ASAAS_BILLING_RULES,
  DEFAULT_CARENCIAS,
  addMonthsIso,
  addYearsIso,
  asaasFetch,
  checkQuarantineBlock,
  formatDateBr,
  generateMatricula,
  getTodayBrazilIso,
  isValidCpf,
  jsonResponse,
  sanitizeCpfCnpj,
} from "./_asaas.mjs";

const VALOR_DEPENDENTE_POSTERIOR = 60.0;
const TAXA_ADESAO_FIXA = 10.0;
const REAJUSTE_ANUAL_PCT = 5.0;

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }

  const store = getStore("clinica-planos-db");
  const today = getTodayBrazilIso();

  try {
    const [rawContratos, rawCarencia, rawSaidas] = await Promise.all([
      store.get("contratos", { type: "json" }).catch(() => []),
      store.get("regras-carencia", { type: "json" }).catch(() => null),
      store.get("historico-saidas", { type: "json" }).catch(() => []),
    ]);

    const contratos = Array.isArray(rawContratos) ? rawContratos : [];
    const regrasCarencia = { ...DEFAULT_CARENCIAS, ...(rawCarencia || {}) };
    let historicoSaidas = Array.isArray(rawSaidas) ? rawSaidas : [];

    // Automação do Reajuste Anual de +5% a cada 1 ano no Asaas
    let houveReajusteAutomatico = false;
    const reajustesAplicados = [];

    for (const c of contratos) {
      if (!c.proximoReajusteEm && c.createdAt) {
        c.proximoReajusteEm = addYearsIso(c.createdAt, 1);
      }
      if (c.status === "ACTIVE" && c.proximoReajusteEm && today >= c.proximoReajusteEm) {
        const valorAnterior = Number(c.valorMensal || 0);
        const novoValor = Number((valorAnterior * (1 + REAJUSTE_ANUAL_PCT / 100)).toFixed(2));
        try {
          await asaasFetch(`/subscriptions/${encodeURIComponent(c.subscriptionId)}`, {
            method: "PUT",
            body: JSON.stringify({
              value: novoValor,
              updatePendingPayments: true,
              ...ASAAS_BILLING_RULES,
            }),
          });
          c.valorMensal = novoValor;
          c.ultimoReajusteEm = today;
          c.proximoReajusteEm = addYearsIso(c.proximoReajusteEm, 1);
          c.historicoEventos = c.historicoEventos || [];
          c.historicoEventos.unshift({
            data: today,
            tipo: "REAJUSTE_ANUAL_AUTO",
            descricao: `📈 Reajuste anual automático de +${REAJUSTE_ANUAL_PCT}% aplicado no Asaas: de R$ ${valorAnterior.toFixed(2)} para R$ ${novoValor.toFixed(2)}. Próximo reajuste em ${formatDateBr(c.proximoReajusteEm)}.`,
          });
          houveReajusteAutomatico = true;
          reajustesAplicados.push({
            titular: c.titularNome,
            de: valorAnterior,
            para: novoValor,
          });
        } catch {
          // Se falhar na API do Asaas neste ciclo, tentará novamente na próxima sincronização
        }
      }
    }

    if (houveReajusteAutomatico) {
      await store.setJSON("contratos", contratos);
    }

    if (event.httpMethod === "GET") {
      return jsonResponse(200, {
        ok: true,
        contratos,
        regrasCarencia,
        historicoSaidas,
        reajustesAplicados,
      });
    }

    if (event.httpMethod !== "POST") {
      return jsonResponse(405, { error: "Método não permitido." });
    }

    const body = JSON.parse(event.body || "{}");
    const { action, subscriptionId } = body;

    // Ações globais (Acesso Master) que não dependem de um contrato específico
    if (action === "UPDATE_CARENCIAS_GLOBAL") {
      const novasRegras = {
        ...regrasCarencia,
        ...(body.regrasCarencia || {}),
      };
      await store.setJSON("regras-carencia", novasRegras);
      return jsonResponse(200, {
        ok: true,
        regrasCarencia: novasRegras,
        resumo: "Regras gerais de carência atualizadas para todos os contratos!",
      });
    }

    if (action === "REMOVE_QUARANTINE") {
      const targetCpf = sanitizeCpfCnpj(body.cpf);
      historicoSaidas = historicoSaidas.filter((h) => sanitizeCpfCnpj(h.cpf) !== targetCpf);
      await store.setJSON("historico-saidas", historicoSaidas);
      return jsonResponse(200, {
        ok: true,
        historicoSaidas,
        resumo: "Bloqueio de 6 meses removido com Acesso Master!",
      });
    }

    const idx = contratos.findIndex((c) => c.subscriptionId === subscriptionId || c.id === subscriptionId);
    if (idx === -1) {
      return jsonResponse(404, { ok: false, error: "Contrato/Assinatura não encontrado no banco de dados." });
    }

    const contrato = contratos[idx];
    contrato.historicoEventos = contrato.historicoEventos || [];

    if (action === "ADD_DEPENDENTS") {
      const rawDeps = Array.isArray(body.dependentes) ? body.dependentes : [];
      const validInput = rawDeps.filter((d) => d && (d.nome || d.cpf || d.dataNascimento));

      if (validInput.length === 0) {
        return jsonResponse(400, { ok: false, error: "Informe pelo menos 1 dependente para adicionar." });
      }

      for (const d of validInput) {
        if (!d.nome || !String(d.nome).trim()) {
          return jsonResponse(400, { ok: false, error: "Informe o nome completo do dependente." });
        }
        if (!isValidCpf(d.cpf)) {
          return jsonResponse(400, {
            ok: false,
            error: `CPF inválido para o dependente "${d.nome}" (${d.cpf || "vazio"}). Verifique os dígitos.`,
          });
        }
        if (!d.dataNascimento) {
          return jsonResponse(400, {
            ok: false,
            error: `Informe a data de nascimento do dependente "${d.nome}".`,
          });
        }
      }

      const novosDeps = validInput.map((d, i) => ({
        id: `dep-${Date.now()}-${i}`,
        nome: String(d.nome).trim(),
        cpf: sanitizeCpfCnpj(d.cpf),
        dataNascimento: d.dataNascimento || null,
        parentesco: String(d.parentesco || "Dependente").trim(),
        dataInclusao: d.dataInclusao || today,
        tipoInclusao: "POSTERIOR",
      }));

      // Verifica bloqueio de 6 meses (quarentena de saída/cancelamento)
      if (!body.masterOverride) {
        for (const dep of novosDeps) {
          if (dep.cpf) {
            const bloqueio = checkQuarantineBlock(historicoSaidas, dep.cpf, today);
            if (bloqueio) {
              return jsonResponse(403, {
                ok: false,
                bloqueioQuarentena: true,
                error: `🚫 Bloqueio de 6 meses: ${dep.nome} (CPF ${bloqueio.cpf}) saiu/cancelou um plano em ${formatDateBr(bloqueio.dataSaida)} e não pode entrar como dependente até ${formatDateBr(bloqueio.bloqueadoAte)} (${bloqueio.motivo}). O responsável do setor pode liberar com Acesso Master.`,
              });
            }
          }
        }
      }

      const qtd = novosDeps.length;
      const acrescimoMensal = Number((qtd * VALOR_DEPENDENTE_POSTERIOR).toFixed(2));
      const valorCobrancaImediata = Number((acrescimoMensal + TAXA_ADESAO_FIXA).toFixed(2));
      const novoValorMensal = Number((Number(contrato.valorMensal || 0) + acrescimoMensal).toFixed(2));
      const totalPessoas = 1 + (contrato.dependentes?.length || 0) + qtd;

      const novaDescricao = `${contrato.planName} (${totalPessoas} pessoas - Titular + ${totalPessoas - 1} dep.)`;
      await asaasFetch(`/subscriptions/${encodeURIComponent(contrato.subscriptionId)}`, {
        method: "PUT",
        body: JSON.stringify({
          value: novoValorMensal,
          description: novaDescricao,
          updatePendingPayments: true,
          ...ASAAS_BILLING_RULES,
        }),
      });

      const dueDate = body.dueDate || today;
      const billingType = body.billingType || contrato.billingType || "BOLETO";
      const nomesAdicionados = novosDeps.map((d) => d.nome).join(", ");

      const payment = await asaasFetch("/payments", {
        method: "POST",
        body: JSON.stringify({
          customer: contrato.customerId,
          billingType,
          value: valorCobrancaImediata,
          dueDate,
          description: `Inclusão de ${qtd} dependente(s) (${nomesAdicionados}): R$ ${acrescimoMensal.toFixed(2)} + Taxa de Adesão R$ ${TAXA_ADESAO_FIXA.toFixed(2)}`,
          ...ASAAS_BILLING_RULES,
        }),
      });

      contrato.dependentes = [...(contrato.dependentes || []), ...novosDeps];
      contrato.valorMensal = novoValorMensal;
      contrato.historicoEventos.unshift({
        data: today,
        tipo: "INCLUSAO_DEPENDENTE",
        descricao: `➕ Incluído(s) ${qtd} dependente(s): ${nomesAdicionados}. Cobrança imediata R$ ${valorCobrancaImediata.toFixed(2)} • Nova mensalidade R$ ${novoValorMensal.toFixed(2)}.${body.masterOverride ? " [Liberado via Acesso Master]" : ""}`,
      });

      contratos[idx] = contrato;
      await store.setJSON("contratos", contratos);

      return jsonResponse(200, {
        ok: true,
        contrato,
        cobrancaAdesao: {
          id: payment.id,
          value: payment.value,
          dueDate: payment.dueDate,
          billingType: payment.billingType,
          invoiceUrl: payment.invoiceUrl,
          bankSlipUrl: payment.bankSlipUrl || null,
        },
        resumo: `${qtd} dependente(s) adicionado(s)! Cobrança imediata gerada: R$ ${valorCobrancaImediata.toFixed(2).replace(".", ",")} • Nova mensalidade no Asaas: R$ ${novoValorMensal.toFixed(2).replace(".", ",")}.`,
      });
    }

    if (action === "REMOVE_DEPENDENT") {
      const { dependenteId, diminuirMensalidade, novoValorMensal } = body;
      const depRemovido = (contrato.dependentes || []).find((d) => d.id === dependenteId);
      if (!depRemovido) {
        return jsonResponse(404, { ok: false, error: "Dependente não encontrado neste contrato." });
      }

      contrato.dependentes = (contrato.dependentes || []).filter((d) => d.id !== dependenteId);

      // Registra o dependente que saiu na quarentena de 6 meses
      const mesesQuarentena = Number(regrasCarencia.quarentenaSaidaMeses || 6);
      const bloqueadoAte = addMonthsIso(today, mesesQuarentena);
      if (depRemovido.cpf) {
        historicoSaidas = historicoSaidas.filter((h) => sanitizeCpfCnpj(h.cpf) !== sanitizeCpfCnpj(depRemovido.cpf));
        historicoSaidas.unshift({
          cpf: sanitizeCpfCnpj(depRemovido.cpf),
          nome: depRemovido.nome,
          tipo: "DEPENDENTE_REMOVIDO",
          titularOrigem: contrato.titularNome,
          dataSaida: today,
          bloqueadoAte,
          motivo: `Saiu como dependente do plano de ${contrato.titularNome}`,
        });
        await store.setJSON("historico-saidas", historicoSaidas);
      }

      if (diminuirMensalidade && Number(novoValorMensal) > 0) {
        const valorAtualizado = Number(Number(novoValorMensal).toFixed(2));
        const totalPessoas = 1 + contrato.dependentes.length;
        await asaasFetch(`/subscriptions/${encodeURIComponent(contrato.subscriptionId)}`, {
          method: "PUT",
          body: JSON.stringify({
            value: valorAtualizado,
            description: `${contrato.planName} (${totalPessoas} pessoa(s))`,
            updatePendingPayments: true,
            ...ASAAS_BILLING_RULES,
          }),
        });
        contrato.valorMensal = valorAtualizado;
      }

      contrato.historicoEventos.unshift({
        data: today,
        tipo: "REMOCAO_DEPENDENTE",
        descricao: `🗑️ Dependente "${depRemovido.nome}" retirado do plano (quarentena de ${mesesQuarentena} meses até ${formatDateBr(bloqueadoAte)}). Mensalidade atual: R$ ${Number(contrato.valorMensal).toFixed(2)}.`,
      });

      contratos[idx] = contrato;
      await store.setJSON("contratos", contratos);

      return jsonResponse(200, {
        ok: true,
        contrato,
        historicoSaidas,
        resumo: `Dependente "${depRemovido.nome}" removido e registrado na carência de ${mesesQuarentena} meses (até ${formatDateBr(bloqueadoAte)}). Mensalidade atual no Asaas: R$ ${Number(contrato.valorMensal).toFixed(2).replace(".", ",")}.`,
      });
    }

    if (action === "CANCEL_CONTRACT") {
      try {
        await asaasFetch(`/subscriptions/${encodeURIComponent(contrato.subscriptionId)}`, {
          method: "DELETE",
        });
      } catch {
        // Caso já esteja inativa no Asaas, segue cancelando no banco
      }

      const mesesQuarentena = Number(regrasCarencia.quarentenaSaidaMeses || 6);
      const bloqueadoAte = addMonthsIso(today, mesesQuarentena);

      const pessoasParaBloquear = [
        {
          cpf: sanitizeCpfCnpj(contrato.titularCpf),
          nome: contrato.titularNome,
          tipo: "TITULAR_CANCELADO",
          motivo: `Cancelou o plano como titular (${contrato.planName})`,
        },
        ...(contrato.dependentes || [])
          .filter((d) => d.cpf)
          .map((d) => ({
            cpf: sanitizeCpfCnpj(d.cpf),
            nome: d.nome,
            tipo: "DEPENDENTE_PLANO_CANCELADO",
            motivo: `Estava como dependente no plano cancelado de ${contrato.titularNome}`,
          })),
      ];

      for (const p of pessoasParaBloquear) {
        if (p.cpf) {
          historicoSaidas = historicoSaidas.filter((h) => sanitizeCpfCnpj(h.cpf) !== p.cpf);
          historicoSaidas.unshift({
            ...p,
            titularOrigem: contrato.titularNome,
            dataSaida: today,
            bloqueadoAte,
          });
        }
      }

      contrato.status = "CANCELED";
      contrato.historicoEventos.unshift({
        data: today,
        tipo: "CANCELAMENTO",
        descricao: `🚫 Contrato cancelado no Asaas. Titular e dependentes em carência de retorno por ${mesesQuarentena} meses (até ${formatDateBr(bloqueadoAte)}).`,
      });

      contratos[idx] = contrato;
      await Promise.all([
        store.setJSON("contratos", contratos),
        store.setJSON("historico-saidas", historicoSaidas),
      ]);

      return jsonResponse(200, {
        ok: true,
        contrato,
        historicoSaidas,
        resumo: `Contrato de ${contrato.titularNome} cancelado no Asaas! Titular e dependentes registrados no bloqueio de ${mesesQuarentena} meses (até ${formatDateBr(bloqueadoAte)}).`,
      });
    }

    if (action === "APPLY_ANNUAL_ADJUSTMENT") {
      const pct = Number(body.percentual || REAJUSTE_ANUAL_PCT);
      const valorAnterior = Number(contrato.valorMensal || 0);
      const novoValor = Number((valorAnterior * (1 + pct / 100)).toFixed(2));

      await asaasFetch(`/subscriptions/${encodeURIComponent(contrato.subscriptionId)}`, {
        method: "PUT",
        body: JSON.stringify({
          value: novoValor,
          updatePendingPayments: true,
          ...ASAAS_BILLING_RULES,
        }),
      });

      contrato.valorMensal = novoValor;
      contrato.ultimoReajusteEm = today;
      contrato.proximoReajusteEm = addYearsIso(contrato.proximoReajusteEm || today, 1);
      contrato.historicoEventos.unshift({
        data: today,
        tipo: "REAJUSTE_ANUAL",
        descricao: `📈 Reajuste anual de +${pct}% aplicado no Asaas: de R$ ${valorAnterior.toFixed(2)} para R$ ${novoValor.toFixed(2)}. Próximo reajuste em ${formatDateBr(contrato.proximoReajusteEm)}.`,
      });

      contratos[idx] = contrato;
      await store.setJSON("contratos", contratos);

      return jsonResponse(200, {
        ok: true,
        contrato,
        resumo: `Reajuste de +${pct}% aplicado no Asaas! Mensalidade passou de R$ ${valorAnterior.toFixed(2).replace(".", ",")} para R$ ${novoValor.toFixed(2).replace(".", ",")}.`,
      });
    }

    if (action === "UPDATE_CARENCIAS_CONTRATO") {
      contrato.carenciasPersonalizadas = body.carenciasPersonalizadas || null;
      contrato.historicoEventos.unshift({
        data: today,
        tipo: "CARENCIA_MASTER",
        descricao: body.carenciasPersonalizadas
          ? `🔐 [Acesso Master] Carências específicas personalizadas para este contrato.`
          : `🔐 [Acesso Master] Contrato voltou a usar a tabela geral de carências.`,
      });
      contratos[idx] = contrato;
      await store.setJSON("contratos", contratos);

      return jsonResponse(200, {
        ok: true,
        contrato,
        resumo: "Carências deste contrato atualizadas com sucesso (Acesso Master)!",
      });
    }

    if (action === "UPDATE_VALUE") {
      const novoValor = Number(body.novoValorMensal);
      if (!novoValor || novoValor <= 0) {
        return jsonResponse(400, { ok: false, error: "Informe um novo valor mensal válido." });
      }

      await asaasFetch(`/subscriptions/${encodeURIComponent(contrato.subscriptionId)}`, {
        method: "PUT",
        body: JSON.stringify({
          value: novoValor,
          updatePendingPayments: true,
          ...ASAAS_BILLING_RULES,
        }),
      });

      contrato.valorMensal = novoValor;
      contrato.historicoEventos.unshift({
        data: today,
        tipo: "ALTERACAO_VALOR",
        descricao: `✏️ Mensalidade alterada para R$ ${novoValor.toFixed(2)} no Asaas.`,
      });
      contratos[idx] = contrato;
      await store.setJSON("contratos", contratos);

      return jsonResponse(200, {
        ok: true,
        contrato,
        resumo: `Valor da mensalidade atualizado no Asaas para R$ ${novoValor.toFixed(2).replace(".", ",")}.`,
      });
    }

    return jsonResponse(400, { ok: false, error: "Ação inválida." });
  } catch (error) {
    return jsonResponse(error.statusCode || 500, {
      ok: false,
      error: error.message || "Erro ao gerenciar plano no Asaas.",
    });
  }
}
