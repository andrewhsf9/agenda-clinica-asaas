import { getStore } from "@netlify/blobs";
import {
  DEFAULT_CARENCIAS,
  asaasFetch,
  evaluateCarencia,
  formatDateBr,
  getTodayBrazilIso,
  jsonResponse,
  sanitizeCpfCnpj,
} from "./_asaas.mjs";

const PAID_STATUSES = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH", "DUNNING_RECEIVED"]);

/**
 * Verifica no Asaas se o paciente (Titular ou Dependente) está com pagamento em dia
 * E se já cumpriu o prazo de carência para o procedimento selecionado:
 * - Exames laboratoriais: 40 dias
 * - Eletrocardiograma e preventivo: 30 dias
 * - Raio-X: 30 dias
 * - Consultas: 30 dias (planos de 1 ou 2 vidas) | Zero carência (planos a partir de 3 vidas)
 * (Com Acesso Master, o responsável consegue liberar a carência ou editar por contrato/global).
 */
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }

  try {
    const params = event.queryStringParameters || {};
    const cpf = sanitizeCpfCnpj(params.cpf);
    const procedimento = params.procedimento || "CONSULTA";
    const masterOverride = params.masterOverride === "true" || params.masterOverride === "1";

    if (!cpf || (cpf.length !== 11 && cpf.length !== 14)) {
      return jsonResponse(400, {
        autorizado: false,
        statusPlano: "CPF_INVALIDO",
        motivo: "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.",
      });
    }

    const today = getTodayBrazilIso();
    let targetCpf = cpf;
    let dependenteInfo = null;
    let contratoLocal = null;
    let dataAdesaoPessoa = null;
    let regrasCarencia = { ...DEFAULT_CARENCIAS };

    try {
      const store = getStore("clinica-planos-db");
      const [contratos, rawCarencia] = await Promise.all([
        store.get("contratos", { type: "json" }).catch(() => []),
        store.get("regras-carencia", { type: "json" }).catch(() => null),
      ]);
      if (rawCarencia) {
        regrasCarencia = { ...DEFAULT_CARENCIAS, ...rawCarencia };
      }

      for (const c of contratos || []) {
        if (c.status === "CANCELED") continue;
        if (sanitizeCpfCnpj(c.titularCpf) === cpf) {
          contratoLocal = c;
          dataAdesaoPessoa = c.createdAt || today;
          break;
        }
        const dep = (c.dependentes || []).find((d) => sanitizeCpfCnpj(d.cpf) === cpf);
        if (dep) {
          contratoLocal = c;
          targetCpf = sanitizeCpfCnpj(c.titularCpf);
          dataAdesaoPessoa = dep.dataInclusao || c.createdAt || today;
          dependenteInfo = {
            nome: dep.nome,
            parentesco: dep.parentesco,
            titularNome: c.titularNome,
            titularCpf: c.titularCpf,
          };
          break;
        }
      }
    } catch {
      // Segue consultando direto no Asaas
    }

    const customersRes = await asaasFetch(`/customers?cpfCnpj=${encodeURIComponent(targetCpf)}&limit=10`);
    const customers = customersRes.data || [];

    if (customers.length === 0) {
      return jsonResponse(200, {
        autorizado: false,
        statusPlano: "NAO_ENCONTRADO",
        motivo: "Paciente (ou titular) não encontrado no Asaas. Não possui plano ativo — agende como Particular ou faça a adesão ao plano.",
      });
    }

    const primaryCustomer = dependenteInfo
      ? { id: customers[0].id, name: `${dependenteInfo.nome} (Dep. de ${dependenteInfo.titularNome})`, cpfCnpj: cpf }
      : customers[0];

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
        motivo: `Agendamento recusado: plano possui ${overduePayments.length} fatura(s) vencida(s) em aberto no Asaas (total R$ ${totalVencido.toFixed(2).replace(".", ",")}, vencimento em ${formatDateBr(maisAntiga.dueDate)}).`,
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

    // 3. Verifica as cobranças da assinatura ativa:
    // Como a 1ª mensalidade é paga no ato do contrato e as cobranças do Asaas vencem a partir do mês seguinte,
    // bloqueia se houver fatura vencendo hoje ou no passado ainda PENDING (não paga).
    const subPayments = allPayments.filter((p) => p.subscription === activeSub.id);
    const paymentsToCheck = subPayments.length > 0 ? subPayments : allPayments;

    const paidPayments = paymentsToCheck.filter((p) => PAID_STATUSES.has(p.status));
    const pendingPayments = paymentsToCheck.filter((p) => p.status === "PENDING");
    const pendingDueToday = pendingPayments.find((p) => p.dueDate && p.dueDate <= today);

    if (pendingDueToday) {
      return jsonResponse(200, {
        autorizado: false,
        statusPlano: "AGUARDANDO_PAGAMENTO",
        motivo: `Agendamento recusado: a fatura de R$ ${Number(pendingDueToday.value || activeSub.value).toFixed(2).replace(".", ",")} com vencimento em ${formatDateBr(pendingDueToday.dueDate)} ainda consta como PENDENTE (aguardando pagamento) no Asaas.`,
        customer: { id: primaryCustomer.id, name: primaryCustomer.name, cpfCnpj: primaryCustomer.cpfCnpj },
        linkRegularizacao: pendingDueToday.invoiceUrl || null,
      });
    }

    // 4. Verifica Carência do Procedimento (baseado na data de adesão e na quantidade de vidas do plano)
    const totalVidas = contratoLocal ? 1 + (contratoLocal.dependentes?.length || 0) : 1;
    const dataInicioCarencia =
      dataAdesaoPessoa || contratoLocal?.createdAt || activeSub.dateCreated || paidPayments[paidPayments.length - 1]?.paymentDate || today;
    const regrasDoContrato = contratoLocal?.carenciasPersonalizadas
      ? { ...regrasCarencia, ...contratoLocal.carenciasPersonalizadas }
      : regrasCarencia;

    const carencia = evaluateCarencia({
      procedimento,
      dataAdesao: dataInicioCarencia,
      totalVidas,
      regras: regrasDoContrato,
      today,
    });

    if (carencia.emCarencia && !masterOverride) {
      return jsonResponse(200, {
        autorizado: false,
        statusPlano: "EM_CARENCIA",
        bloqueioCarencia: true,
        carencia,
        motivo: `⏳ Em período de carência para ${carencia.nomeProcedimento} (plano com ${totalVidas} vida(s)): paciente aderiu em ${formatDateBr(carencia.dataAdesao)} (${carencia.diasCorridos} dia(s) cumpridos de ${carencia.diasExigidos} exigidos). Liberação em ${formatDateBr(carencia.liberaEm)} (faltam ${carencia.diasRestantes} dia(s)).`,
        customer: { id: primaryCustomer.id, name: primaryCustomer.name, cpfCnpj: primaryCustomer.cpfCnpj },
      });
    }

    const ultimoPago = paidPayments[0];
    const infoPagamento = ultimoPago
      ? `Última fatura Asaas paga: R$ ${Number(ultimoPago.value).toFixed(2).replace(".", ",")}`
      : `1ª mensalidade paga no ato do contrato`;

    return jsonResponse(200, {
      autorizado: true,
      statusPlano: "EM_DIA",
      carencia,
      motivo: `Plano em dia e carência cumprida para ${carencia.nomeProcedimento}! (${totalVidas} vida(s) • Adesão: ${formatDateBr(carencia.dataAdesao)} • ${infoPagamento} • Próx. vencimento Asaas: ${formatDateBr(activeSub.nextDueDate)})${masterOverride && carencia.emCarencia ? " [Carência liberada com Acesso Master]" : ""}`,
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
