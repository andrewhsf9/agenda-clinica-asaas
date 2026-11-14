(() => {
  const CFG = window.CLINICA_CONFIG;
  const REGRAS = CFG.regrasFinanceiras || {
    taxaAdesaoFixa: 10.0,
    valorDependentePosterior: 60.0,
    descontoPontualidadePct: 5,
    multaAtrasoPct: 2,
    jurosMensalPct: 2,
    reajusteAnualPct: 5,
  };

  const STORAGE_KEY = "clinica_asaas_appointments_v1";
  const CONTRATOS_KEY = "clinica_asaas_contratos_v1";
  const CARENCIAS_KEY = "clinica_asaas_carencias_v1";
  const SAIDAS_KEY = "clinica_asaas_saidas_v1";
  const MODE_KEY = "clinica_asaas_mode_v1";
  const FONT_KEY = "clinica_asaas_font_px_v1";

  let appointments = [];
  let contratos = [];
  let regrasCarencia = { ...(CFG.regrasCarenciaPadrao || {}) };
  let historicoSaidas = [];
  let currentFilter = "ALL";
  let currentProfFilter = "ALL";
  let lastPlanCheck = null;

  const $ = (id) => document.getElementById(id);

  function sanitizeDoc(v) {
    return String(v || "").replace(/\D/g, "");
  }

  function formatCpf(v) {
    const d = sanitizeDoc(v).slice(0, 14);
    if (d.length <= 11) {
      return d
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    }
    return d
      .replace(/^(\d{2})(\d)/, "$1.$2")
      .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1/$2")
      .replace(/(\d{4})(\d)/, "$1-$2");
  }

  function maskCpf(v) {
    const d = sanitizeDoc(v);
    if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
    return v || "-";
  }

  function formatMoney(v) {
    return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function formatDateBr(isoDate) {
    if (!isoDate) return "-";
    const [y, m, d] = String(isoDate).split("-");
    return d && m && y ? `${d}/${m}/${y}` : isoDate;
  }

  function getTodayIso() {
    const now = new Date();
    const off = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - off).toISOString().slice(0, 10);
  }

  function addDaysIso(isoDate, days) {
    const dt = new Date(`${isoDate}T12:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
    return dt.toISOString().slice(0, 10);
  }

  function addMonthsIso(isoDate, months) {
    const dt = new Date(`${isoDate}T12:00:00Z`);
    dt.setUTCMonth(dt.getUTCMonth() + Number(months || 0));
    return dt.toISOString().slice(0, 10);
  }

  function addYearsIso(isoDate, years) {
    const dt = new Date(`${isoDate}T12:00:00Z`);
    dt.setUTCFullYear(dt.getUTCFullYear() + Number(years || 0));
    return dt.toISOString().slice(0, 10);
  }

  function daysBetween(startIso, endIso) {
    if (!startIso || !endIso) return 0;
    const s = new Date(`${startIso}T00:00:00Z`).getTime();
    const e = new Date(`${endIso}T00:00:00Z`).getTime();
    return Math.floor((e - s) / 86400000);
  }

  function requestMasterAuth(acaoDescricao) {
    const pin = prompt(
      `🔐 ACESSO MASTER NECESSÁRIO\nMotivo: ${acaoDescricao}\n\nDigite a Senha Master do responsável pelo setor (padrão: ${CFG.pinMaster || "9999"}):`
    );
    if (pin === null) return false;
    if (pin === (CFG.pinMaster || "9999")) return true;
    alert("❌ Senha Master incorreta!");
    return false;
  }

  function evaluateCarenciaLocal({ procedimento = "CONSULTA", dataAdesao, totalVidas = 1, regras }) {
    const r = { ...(CFG.regrasCarenciaPadrao || {}), ...regrasCarencia, ...(regras || {}) };
    const today = getTodayIso();
    let diasExigidos = 0;
    let nomeProcedimento = "Consulta Médica";

    if (procedimento === "EXAME_LAB") {
      diasExigidos = Number(r.examesLaboratoriaisDias ?? 40);
      nomeProcedimento = "Exames Laboratoriais";
    } else if (procedimento === "ELETRO_PREV") {
      diasExigidos = Number(r.eletroPreventivoDias ?? 30);
      nomeProcedimento = "Eletrocardiograma / Preventivo";
    } else if (procedimento === "RAIO_X") {
      diasExigidos = Number(r.raioXDias ?? 30);
      nomeProcedimento = "Raio-X";
    } else {
      nomeProcedimento = "Consulta Médica";
      diasExigidos =
        Number(totalVidas) >= 3
          ? Number(r.consulta3MaisVidasDias ?? 0)
          : Number(r.consulta1a2VidasDias ?? 30);
    }

    const adesao = dataAdesao || today;
    const diasCorridos = Math.max(0, daysBetween(adesao, today));
    const liberaEm = addDaysIso(adesao, diasExigidos);
    const emCarencia = diasCorridos < diasExigidos;

    return {
      emCarencia,
      diasExigidos,
      diasCorridos,
      diasRestantes: Math.max(0, diasExigidos - diasCorridos),
      dataAdesao: adesao,
      liberaEm,
      nomeProcedimento,
    };
  }

  function isLiveMode() {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === "netlify") return true;
    if (saved === "demo") return false;
    if (CFG.modoIntegracao === "netlify") return true;
    if (CFG.modoIntegracao === "demo") return false;
    return window.location.protocol.startsWith("http") && !window.location.hostname.includes("localhost")
      ? true
      : window.location.port === "8888";
  }

  function updateModeUI() {
    const live = isLiveMode();
    const badge = $("integration-badge");
    const hints = $("demo-cpf-hints");
    if (live) {
      badge.textContent = "🟢 Asaas Conectado";
      badge.className = "mode-badge mode-live";
      hints.classList.add("hidden");
    } else {
      badge.textContent = "🧪 Modo Demo";
      badge.className = "mode-badge mode-demo";
      hints.classList.remove("hidden");
    }
  }

  function buildBoletoWhatsAppUrl({ phone, nome, descricao, valor, vencimento, link }) {
    const cleanPhone = sanitizeDoc(phone);
    const valorComDesconto = Number(valor || 0) * (1 - REGRAS.descontoPontualidadePct / 100);
    const msg =
      `Olá ${nome}! Segue seu boleto/fatura da *${CFG.nomeClinica}* (${descricao}).\n` +
      `💰 *Valor:* ${formatMoney(valor)}\n` +
      `🎁 *Pagando até o vencimento (${formatDateBr(vencimento)}) você tem ${REGRAS.descontoPontualidadePct}% de desconto:* ${formatMoney(valorComDesconto)}\n` +
      `⚠️ *(Após o vencimento: multa de ${REGRAS.multaAtrasoPct}% e juros de ${REGRAS.jurosMensalPct}% a.m.)*\n` +
      `🔗 *Link do Boleto / Pagamento Asaas:* ${link || "Consulte a recepção"}`;
    const base = cleanPhone ? `https://wa.me/55${cleanPhone}` : "https://wa.me/";
    return `${base}?text=${encodeURIComponent(msg)}`;
  }

  // --- Camada de API ---

  async function apiVerificarPlano(cpf, procedimento = "CONSULTA", masterOverride = false) {
    const clean = sanitizeDoc(cpf);

    if (!isLiveMode()) {
      let targetClean = clean;
      let depLocal = null;
      let contratoLocal = null;
      let dataAdesaoPessoa = getTodayIso();

      for (const c of contratos) {
        if (c.status === "CANCELED") continue;
        if (sanitizeDoc(c.titularCpf) === clean) {
          contratoLocal = c;
          dataAdesaoPessoa = c.createdAt;
          break;
        }
        const dep = (c.dependentes || []).find((d) => sanitizeDoc(d.cpf) === clean);
        if (dep) {
          contratoLocal = c;
          targetClean = sanitizeDoc(c.titularCpf);
          dataAdesaoPessoa = dep.dataInclusao || c.createdAt;
          depLocal = { nome: dep.nome, titularNome: c.titularNome };
          break;
        }
      }

      const cli = CFG.demoClientesAsaas[targetClean];
      if (!cli) {
        return {
          autorizado: false,
          statusPlano: "NAO_ENCONTRADO",
          motivo: "Paciente não encontrado no Asaas. Não possui plano ativo — agende como Particular ou faça a adesão ao plano.",
        };
      }
      if (cli.situacao === "INADIMPLENTE") {
        const fat = cli.faturasVencidas[0];
        return {
          autorizado: false,
          statusPlano: "INADIMPLENTE",
          motivo: `Agendamento recusado: plano possui ${cli.faturasVencidas.length} fatura(s) vencida(s) no Asaas (total ${formatMoney(fat.value)}, vencimento em ${formatDateBr(fat.dueDate)}).`,
          customer: {
            id: cli.id,
            name: depLocal ? `${depLocal.nome} (Dep. de ${depLocal.titularNome})` : cli.name,
            cpfCnpj: clean,
          },
          faturasVencidas: cli.faturasVencidas,
          linkRegularizacao: fat.invoiceUrl,
        };
      }
      if (cli.situacao !== "EM_DIA" || !cli.plano) {
        return {
          autorizado: false,
          statusPlano: "SEM_PLANO_ATIVO",
          motivo: "Agendamento pelo plano recusado: nenhuma assinatura de plano ativa encontrada para este CPF.",
          customer: { id: cli.id, name: cli.name, cpfCnpj: clean },
        };
      }

      const totalVidas = contratoLocal ? 1 + (contratoLocal.dependentes?.length || 0) : 2;
      const carencia = evaluateCarenciaLocal({
        procedimento,
        dataAdesao: dataAdesaoPessoa,
        totalVidas,
        regras: contratoLocal?.carenciasPersonalizadas,
      });

      if (carencia.emCarencia && !masterOverride) {
        return {
          autorizado: false,
          statusPlano: "EM_CARENCIA",
          bloqueioCarencia: true,
          carencia,
          motivo: `⏳ Em período de carência para ${carencia.nomeProcedimento} (${totalVidas} vida(s) no contrato): aderiu em ${formatDateBr(carencia.dataAdesao)} (${carencia.diasCorridos} dia(s) cumpridos de ${carencia.diasExigidos} exigidos). Liberação em ${formatDateBr(carencia.liberaEm)} (faltam ${carencia.diasRestantes} dia(s)).`,
          customer: {
            id: cli.id,
            name: depLocal ? `${depLocal.nome} (Dep. de ${depLocal.titularNome})` : cli.name,
            cpfCnpj: clean,
          },
        };
      }

      return {
        autorizado: true,
        statusPlano: "EM_DIA",
        carencia,
        motivo: `Plano em dia e carência cumprida para ${carencia.nomeProcedimento}! (${totalVidas} vida(s) • Próx. vencimento: ${formatDateBr(cli.plano.nextDueDate)})${masterOverride && carencia.emCarencia ? " [Carência liberada com Acesso Master]" : ""}`,
        customer: {
          id: cli.id,
          name: depLocal ? `${depLocal.nome} (Dep. de ${depLocal.titularNome})` : cli.name,
          cpfCnpj: clean,
        },
        plano: cli.plano,
      };
    }

    const url = `/.netlify/functions/asaas-verificar-plano?cpf=${encodeURIComponent(clean)}&procedimento=${encodeURIComponent(procedimento)}&masterOverride=${masterOverride ? "true" : "false"}`;
    const res = await fetch(url);
    return res.json();
  }

  async function apiCriarCobranca(payload) {
    if (!isLiveMode()) {
      const id = "pay_demo_" + Math.random().toString(36).slice(2, 9);
      const isPix = payload.billingType === "PIX";
      return {
        ok: true,
        customer: { id: "cus_demo_new", name: payload.name },
        payment: {
          id,
          status: "PENDING",
          value: Number(payload.value),
          dueDate: payload.dueDate,
          billingType: payload.billingType,
          invoiceUrl: `https://sandbox.asaas.com/i/${id}`,
          bankSlipUrl: payload.billingType === "BOLETO" ? `https://sandbox.asaas.com/b/${id}` : null,
        },
        pix: isPix
          ? {
              encodedImage: null,
              payload: `00020126580014BR.GOV.BCB.PIX0136demo-asaas-${id}5204000053039865406${Number(payload.value).toFixed(2)}`,
              expirationDate: new Date(Date.now() + 86400000).toISOString(),
            }
          : null,
      };
    }

    const res = await fetch("/.netlify/functions/asaas-criar-cobranca", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.json();
  }

  function findLocalQuarantine(cpf) {
    const clean = sanitizeDoc(cpf);
    const today = getTodayIso();
    return historicoSaidas.find(
      (h) => sanitizeDoc(h.cpf) === clean && h.bloqueadoAte && h.bloqueadoAte >= today
    );
  }

  async function apiCriarAssinatura(payload) {
    if (!isLiveMode()) {
      const clean = sanitizeDoc(payload.cpfCnpj);
      const today = getTodayIso();

      if (!payload.masterOverride) {
        const bloqTit = findLocalQuarantine(clean);
        if (bloqTit) {
          return {
            ok: false,
            bloqueioQuarentena: true,
            error: `🚫 Bloqueio de 6 meses: o titular ${bloqTit.nome} (CPF ${formatCpf(bloqTit.cpf)}) saiu/cancelou o plano em ${formatDateBr(bloqTit.dataSaida)} e não pode reativar até ${formatDateBr(bloqTit.bloqueadoAte)}.`,
          };
        }
        for (const d of payload.dependentes || []) {
          if (d.cpf) {
            const bloqDep = findLocalQuarantine(d.cpf);
            if (bloqDep) {
              return {
                ok: false,
                bloqueioQuarentena: true,
                error: `🚫 Bloqueio de 6 meses: o dependente ${d.nome} (CPF ${formatCpf(bloqDep.cpf)}) saiu/cancelou um plano em ${formatDateBr(bloqDep.dataSaida)} e não pode entrar em outro plano até ${formatDateBr(bloqDep.bloqueadoAte)}.`,
              };
            }
          }
        }
      }

      const subId = "sub_demo_" + Math.random().toString(36).slice(2, 8);
      const valorMensal = Number(payload.value);
      const valorPrimeira = Number((valorMensal + Number(payload.taxaAdesao || 10)).toFixed(2));
      const adesaoIso = payload.dataAdesao || today;
      const proximoReajusteEm = addYearsIso(adesaoIso, 1);

      const contrato = {
        id: subId,
        subscriptionId: subId,
        customerId: "cus_demo_" + clean.slice(0, 4),
        titularNome: payload.name,
        titularCpf: clean,
        titularPhone: sanitizeDoc(payload.phone),
        planId: payload.planId,
        planCategory: payload.planCategory,
        planName: payload.description,
        valorMensal,
        taxaAdesaoInicial: Number(payload.taxaAdesao || 10),
        billingType: payload.billingType,
        nextDueDate: payload.nextDueDate || today,
        endDate: payload.endDate || null,
        createdAt: adesaoIso,
        proximoReajusteEm,
        ultimoReajusteEm: null,
        carenciasPersonalizadas: null,
        status: "ACTIVE",
        firstPaymentUrl: `https://sandbox.asaas.com/b/${subId}`,
        firstPaymentInvoiceUrl: `https://sandbox.asaas.com/i/${subId}`,
        firstPaymentValue: valorPrimeira,
        dependentes: (payload.dependentes || []).map((d, i) => ({
          id: `dep-${Date.now()}-${i}`,
          nome: d.nome,
          cpf: sanitizeDoc(d.cpf),
          parentesco: d.parentesco || "Dependente",
          dataInclusao: adesaoIso,
          tipoInclusao: "ADESAO_INICIAL",
        })),
        historicoEventos: [
          {
            data: today,
            tipo: "ADESAO",
            descricao: `Plano criado com adesão em ${formatDateBr(adesaoIso)} (${1 + (payload.dependentes?.length || 0)} vida(s) • ${formatMoney(valorMensal)}/mês + R$ 10,00 tx adesão). Próximo reajuste anual (+5%) em ${formatDateBr(proximoReajusteEm)}.`,
          },
        ],
      };

      CFG.demoClientesAsaas[clean] = {
        id: contrato.customerId,
        name: payload.name,
        cpfCnpj: clean,
        phone: payload.phone,
        situacao: "EM_DIA",
        plano: {
          id: subId,
          description: payload.description,
          value: valorMensal,
          cycle: "MONTHLY",
          nextDueDate: contrato.nextDueDate,
          status: "ACTIVE",
        },
        faturasVencidas: [],
      };

      return {
        ok: true,
        contrato,
        subscription: {
          id: subId,
          status: "ACTIVE",
          value: valorMensal,
          nextDueDate: contrato.nextDueDate,
          endDate: contrato.endDate,
          description: payload.description,
        },
        firstPayment: {
          id: "pay_demo_first",
          status: "PENDING",
          value: valorPrimeira,
          dueDate: contrato.nextDueDate,
          invoiceUrl: contrato.firstPaymentInvoiceUrl,
          bankSlipUrl: contrato.firstPaymentUrl,
        },
      };
    }

    const res = await fetch("/.netlify/functions/asaas-criar-assinatura", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.json();
  }

  async function apiListarPlanosDb() {
    if (!isLiveMode()) {
      return { ok: true, contratos, regrasCarencia, historicoSaidas };
    }
    try {
      const res = await fetch("/.netlify/functions/asaas-gerenciar-plano");
      const data = await res.json();
      if (data.ok) {
        if (Array.isArray(data.contratos)) contratos = data.contratos;
        if (data.regrasCarencia) regrasCarencia = data.regrasCarencia;
        if (Array.isArray(data.historicoSaidas)) historicoSaidas = data.historicoSaidas;
        saveContratosLocal();
        if (data.reajustesAplicados?.length > 0) {
          alert(
            `📈 Reajuste Anual Automático (+5%) aplicado no Asaas para ${data.reajustesAplicados.length} contrato(s) que completaram 1 ano!`
          );
        }
      }
      return data;
    } catch {
      return { ok: false, contratos };
    }
  }

  async function apiGerenciarPlano(payload) {
    if (!isLiveMode()) {
      const today = getTodayIso();

      if (payload.action === "UPDATE_CARENCIAS_GLOBAL") {
        regrasCarencia = { ...regrasCarencia, ...(payload.regrasCarencia || {}) };
        saveContratosLocal();
        return { ok: true, regrasCarencia, resumo: "Regras gerais de carência atualizadas!" };
      }

      if (payload.action === "REMOVE_QUARANTINE") {
        const clean = sanitizeDoc(payload.cpf);
        historicoSaidas = historicoSaidas.filter((h) => sanitizeDoc(h.cpf) !== clean);
        saveContratosLocal();
        return { ok: true, historicoSaidas, resumo: "Bloqueio de 6 meses removido com Acesso Master!" };
      }

      const idx = contratos.findIndex((c) => c.subscriptionId === payload.subscriptionId);
      if (idx === -1) return { ok: false, error: "Contrato não encontrado." };
      const c = contratos[idx];
      c.historicoEventos = c.historicoEventos || [];

      if (payload.action === "ADD_DEPENDENTS") {
        if (!payload.masterOverride) {
          for (const d of payload.dependentes || []) {
            if (d.cpf) {
              const bloq = findLocalQuarantine(d.cpf);
              if (bloq) {
                return {
                  ok: false,
                  bloqueioQuarentena: true,
                  error: `🚫 Bloqueio de 6 meses: ${d.nome} (CPF ${formatCpf(bloq.cpf)}) saiu/cancelou um plano em ${formatDateBr(bloq.dataSaida)} e não pode entrar como dependente até ${formatDateBr(bloq.bloqueadoAte)}.`,
                };
              }
            }
          }
        }

        const novos = (payload.dependentes || []).map((d, i) => ({
          id: `dep-${Date.now()}-${i}`,
          nome: d.nome,
          cpf: sanitizeDoc(d.cpf),
          parentesco: d.parentesco || "Dependente",
          dataInclusao: today,
          tipoInclusao: "POSTERIOR",
        }));
        const qtd = novos.length;
        const acrescimo = qtd * REGRAS.valorDependentePosterior;
        const imediato = acrescimo + REGRAS.taxaAdesaoFixa;
        c.dependentes = [...(c.dependentes || []), ...novos];
        c.valorMensal = Number((Number(c.valorMensal) + acrescimo).toFixed(2));
        c.historicoEventos.unshift({
          data: today,
          tipo: "INCLUSAO_DEPENDENTE",
          descricao: `➕ Incluído(s) ${qtd} dependente(s). Cobrança imediata ${formatMoney(imediato)} • Nova mensalidade ${formatMoney(c.valorMensal)}.`,
        });
        saveContratosLocal();
        return {
          ok: true,
          contrato: c,
          cobrancaAdesao: {
            id: "pay_demo_dep_" + Date.now(),
            value: imediato,
            dueDate: payload.dueDate || today,
            invoiceUrl: `https://sandbox.asaas.com/i/dep-${Date.now()}`,
            bankSlipUrl: `https://sandbox.asaas.com/b/dep-${Date.now()}`,
          },
          resumo: `${qtd} dependente(s) incluído(s)! Boleto imediato: ${formatMoney(imediato)} • Nova mensalidade Asaas: ${formatMoney(c.valorMensal)}.`,
        };
      }

      if (payload.action === "REMOVE_DEPENDENT") {
        const dep = (c.dependentes || []).find((d) => d.id === payload.dependenteId);
        c.dependentes = (c.dependentes || []).filter((d) => d.id !== payload.dependenteId);
        const mesesQ = Number(regrasCarencia.quarentenaSaidaMeses || 6);
        const bloqueadoAte = addMonthsIso(today, mesesQ);
        if (dep?.cpf) {
          historicoSaidas = historicoSaidas.filter((h) => sanitizeDoc(h.cpf) !== sanitizeDoc(dep.cpf));
          historicoSaidas.unshift({
            cpf: sanitizeDoc(dep.cpf),
            nome: dep.nome,
            tipo: "DEPENDENTE_REMOVIDO",
            titularOrigem: c.titularNome,
            dataSaida: today,
            bloqueadoAte,
            motivo: `Saiu como dependente do plano de ${c.titularNome}`,
          });
        }
        if (payload.diminuirMensalidade && Number(payload.novoValorMensal) > 0) {
          c.valorMensal = Number(payload.novoValorMensal);
        }
        c.historicoEventos.unshift({
          data: today,
          tipo: "REMOCAO_DEPENDENTE",
          descricao: `🗑️ Dependente "${dep?.nome || ""}" retirado (bloqueado por ${mesesQ} meses até ${formatDateBr(bloqueadoAte)}). Mensalidade: ${formatMoney(c.valorMensal)}.`,
        });
        saveContratosLocal();
        return {
          ok: true,
          contrato: c,
          historicoSaidas,
          resumo: `Dependente retirado e registrado no bloqueio de ${mesesQ} meses! Mensalidade no Asaas: ${formatMoney(c.valorMensal)}.`,
        };
      }

      if (payload.action === "CANCEL_CONTRACT") {
        const mesesQ = Number(regrasCarencia.quarentenaSaidaMeses || 6);
        const bloqueadoAte = addMonthsIso(today, mesesQ);
        const lista = [
          { cpf: sanitizeDoc(c.titularCpf), nome: c.titularNome, motivo: `Cancelou o plano (${c.planName})` },
          ...(c.dependentes || []).filter((d) => d.cpf).map((d) => ({
            cpf: sanitizeDoc(d.cpf),
            nome: d.nome,
            motivo: `Dependente do plano cancelado de ${c.titularNome}`,
          })),
        ];
        lista.forEach((p) => {
          if (p.cpf) {
            historicoSaidas = historicoSaidas.filter((h) => sanitizeDoc(h.cpf) !== p.cpf);
            historicoSaidas.unshift({ ...p, dataSaida: today, bloqueadoAte });
          }
        });
        c.status = "CANCELED";
        c.historicoEventos.unshift({
          data: today,
          tipo: "CANCELAMENTO",
          descricao: `🚫 Contrato cancelado. Titular e dependentes bloqueados por ${mesesQ} meses até ${formatDateBr(bloqueadoAte)}.`,
        });
        saveContratosLocal();
        return {
          ok: true,
          contrato: c,
          historicoSaidas,
          resumo: `Contrato cancelado e CPFs registrados na carência de ${mesesQ} meses (até ${formatDateBr(bloqueadoAte)}).`,
        };
      }

      if (payload.action === "APPLY_ANNUAL_ADJUSTMENT") {
        const pct = Number(payload.percentual || REGRAS.reajusteAnualPct || 5);
        const ant = Number(c.valorMensal);
        c.valorMensal = Number((ant * (1 + pct / 100)).toFixed(2));
        c.ultimoReajusteEm = today;
        c.proximoReajusteEm = addYearsIso(c.proximoReajusteEm || today, 1);
        c.historicoEventos.unshift({
          data: today,
          tipo: "REAJUSTE_ANUAL",
          descricao: `📈 Reajuste anual de +${pct}% aplicado no Asaas: de ${formatMoney(ant)} para ${formatMoney(c.valorMensal)}.`,
        });
        saveContratosLocal();
        return {
          ok: true,
          contrato: c,
          resumo: `Reajuste anual de +${pct}% aplicado! Nova mensalidade: ${formatMoney(c.valorMensal)}.`,
        };
      }

      if (payload.action === "UPDATE_CARENCIAS_CONTRATO") {
        c.carenciasPersonalizadas = payload.carenciasPersonalizadas || null;
        c.historicoEventos.unshift({
          data: today,
          tipo: "CARENCIA_MASTER",
          descricao: payload.carenciasPersonalizadas
            ? `🔐 [Acesso Master] Carências específicas personalizadas para este contrato.`
            : `🔐 [Acesso Master] Contrato voltou a usar a tabela geral de carências.`,
        });
        saveContratosLocal();
        return { ok: true, contrato: c, resumo: "Carências deste contrato atualizadas!" };
      }

      if (payload.action === "UPDATE_VALUE") {
        c.valorMensal = Number(payload.novoValorMensal);
        saveContratosLocal();
        return {
          ok: true,
          contrato: c,
          resumo: `Mensalidade atualizada no Asaas para ${formatMoney(c.valorMensal)}.`,
        };
      }
    }

    const res = await fetch("/.netlify/functions/asaas-gerenciar-plano", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.ok) {
      if (data.contrato) {
        const idx = contratos.findIndex((c) => c.subscriptionId === data.contrato.subscriptionId);
        if (idx >= 0) contratos[idx] = data.contrato;
        else contratos.unshift(data.contrato);
      }
      if (data.regrasCarencia) regrasCarencia = data.regrasCarencia;
      if (Array.isArray(data.historicoSaidas)) historicoSaidas = data.historicoSaidas;
      saveContratosLocal();
    }
    return data;
  }

  async function apiConsultarCobranca(paymentId) {
    if (!isLiveMode()) {
      return { ok: true, payment: { id: paymentId, status: "RECEIVED" } };
    }
    const res = await fetch(`/.netlify/functions/asaas-consultar-cobranca?id=${encodeURIComponent(paymentId)}`);
    return res.json();
  }

  // --- Persistência Local ---

  function seedDemoContratos() {
    const today = getTodayIso();
    const adesaoAntiga = addDaysIso(today, -15); // Aderiu há 15 dias para demonstrar carências
    return [
      {
        id: "sub_demo_001",
        subscriptionId: "sub_demo_001",
        customerId: "cus_demo_001",
        titularNome: "Maria Aparecida Silva",
        titularCpf: "11111111111",
        titularPhone: "11999991111",
        planId: "plano-2",
        planCategory: "TABELA",
        planName: "Plano 2 Pessoas (Titular + 1 dependente)",
        valorMensal: 170.0,
        taxaAdesaoInicial: 10.0,
        billingType: "BOLETO",
        nextDueDate: "2026-12-10",
        endDate: null,
        createdAt: adesaoAntiga,
        proximoReajusteEm: addYearsIso(adesaoAntiga, 1),
        ultimoReajusteEm: null,
        carenciasPersonalizadas: null,
        status: "ACTIVE",
        firstPaymentUrl: "https://sandbox.asaas.com/b/sub_demo_001",
        firstPaymentInvoiceUrl: "https://sandbox.asaas.com/i/sub_demo_001",
        firstPaymentValue: 180.0,
        dependentes: [
          {
            id: "dep-demo-1",
            nome: "Lucas Silva",
            cpf: "44444444444",
            parentesco: "Filho(a)",
            dataInclusao: adesaoAntiga,
            tipoInclusao: "ADESAO_INICIAL",
          },
        ],
        historicoEventos: [
          {
            data: adesaoAntiga,
            tipo: "ADESAO",
            descricao: `Plano criado em ${formatDateBr(adesaoAntiga)} (2 vidas • R$ 170,00/mês + R$ 10,00 tx adesão).`,
          },
        ],
      },
    ];
  }

  function loadContratosLocal() {
    try {
      const raw = localStorage.getItem(CONTRATOS_KEY);
      contratos = raw ? JSON.parse(raw) : seedDemoContratos();
      const rawCar = localStorage.getItem(CARENCIAS_KEY);
      if (rawCar) regrasCarencia = { ...regrasCarencia, ...JSON.parse(rawCar) };
      const rawSai = localStorage.getItem(SAIDAS_KEY);
      if (rawSai) historicoSaidas = JSON.parse(rawSai);
      if (!raw) saveContratosLocal();
    } catch {
      contratos = seedDemoContratos();
    }
  }

  function saveContratosLocal() {
    localStorage.setItem(CONTRATOS_KEY, JSON.stringify(contratos));
    localStorage.setItem(CARENCIAS_KEY, JSON.stringify(regrasCarencia));
    localStorage.setItem(SAIDAS_KEY, JSON.stringify(historicoSaidas));
    $("badge-count-planos").textContent = contratos.filter((c) => c.status !== "CANCELED").length;
  }

  function seedDemoAppointments() {
    const today = getTodayIso();
    return [
      {
        id: "apt-1",
        date: today,
        time: "09:00",
        patientName: "Maria Aparecida Silva",
        cpf: "111.111.111-11",
        phone: "11999991111",
        professionalId: "dr-carlos",
        professionalName: "Dr. Carlos Mendes (Clínico Geral)",
        procedureName: "Consulta Médica",
        type: "PLANO",
        status: "CONFIRMED",
        statusLabel: "Plano em Dia",
        value: 0,
        billingType: null,
        paymentId: null,
        invoiceUrl: null,
        reason: null,
      },
    ];
  }

  function loadAppointments() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      appointments = raw ? JSON.parse(raw) : seedDemoAppointments();
      if (!raw) saveAppointments();
    } catch {
      appointments = seedDemoAppointments();
    }
  }

  function saveAppointments() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appointments));
  }

  // --- Renderização da Agenda ---

  function renderStats() {
    const confirmadas = appointments.filter((a) => a.status === "CONFIRMED").length;
    const pendentes = appointments.filter((a) => a.status === "PENDING").length;
    const recusadas = appointments.filter((a) => a.status === "REFUSED").length;
    const total = appointments
      .filter((a) => a.type === "PARTICULAR" && a.status === "CONFIRMED")
      .reduce((sum, a) => sum + Number(a.value || 0), 0);

    $("stat-confirmadas").textContent = confirmadas;
    $("stat-pendentes").textContent = pendentes;
    $("stat-recusadas").textContent = recusadas;
    $("stat-total").textContent = formatMoney(total);
  }

  function getBadgeHtml(appt) {
    if (appt.status === "CONFIRMED") {
      return `<span class="badge badge-green">✅ ${appt.statusLabel || "Confirmada"}</span>`;
    }
    if (appt.status === "PENDING") {
      return `<span class="badge badge-amber">⏳ ${appt.statusLabel || "Aguardando Pagamento"}</span>`;
    }
    return `<span class="badge badge-red">🚫 ${appt.statusLabel || "Recusada"}</span>`;
  }

  function buildWhatsAppUrl(appt) {
    const phone = sanitizeDoc(appt.phone);
    if (appt.status === "PENDING" && appt.invoiceUrl) {
      return buildBoletoWhatsAppUrl({
        phone,
        nome: appt.patientName,
        descricao: `${appt.procedureName || "Consulta"} com ${appt.professionalName} em ${formatDateBr(appt.date)} às ${appt.time}`,
        valor: appt.value,
        vencimento: appt.date,
        link: appt.bankSlipUrl || appt.invoiceUrl,
      });
    }
    let msg = "";
    if (appt.status === "REFUSED") {
      msg = `Olá ${appt.patientName}! Sobre seu agendamento na ${CFG.nomeClinica}: ${appt.reason} ${appt.invoiceUrl ? `Link para regularização: ${appt.invoiceUrl}` : ""}`;
    } else {
      msg = `Olá ${appt.patientName}! Confirmamos seu agendamento (${appt.procedureName || "Consulta"}) na ${CFG.nomeClinica} com ${appt.professionalName} no dia ${formatDateBr(appt.date)} às ${appt.time}.`;
    }
    const base = phone ? `https://wa.me/55${phone}` : "https://wa.me/";
    return `${base}?text=${encodeURIComponent(msg)}`;
  }

  function renderAgenda() {
    renderStats();
    const listEl = $("agenda-list");

    const filtered = appointments
      .filter((a) => currentFilter === "ALL" || a.status === currentFilter)
      .filter((a) => currentProfFilter === "ALL" || a.professionalId === currentProfFilter)
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="empty-state">Nenhuma consulta encontrada para este filtro. Clique em <strong>+ Nova Consulta / Exame</strong> para agendar.</div>`;
      return;
    }

    const groups = {};
    for (const appt of filtered) {
      if (!groups[appt.date]) groups[appt.date] = [];
      groups[appt.date].push(appt);
    }

    listEl.innerHTML = Object.entries(groups)
      .map(([date, items]) => {
        const cards = items
          .map(
            (a) => `
          <article class="appt-card status-${a.status}">
            <div class="appt-main">
              <div class="appt-top">
                <span class="appt-time">🕒 ${a.time}</span>
                ${getBadgeHtml(a)}
                <span class="badge badge-teal">${a.type === "PLANO" ? "🪪 Plano" : `💳 Particular (${formatMoney(a.value)})`}</span>
                ${a.procedureName ? `<span class="badge badge-amber">${a.procedureName}</span>` : ""}
              </div>
              <h3 class="appt-patient">${a.patientName} <small class="muted">(${maskCpf(a.cpf)})</small></h3>
              <p class="appt-meta">${a.professionalName}</p>
              ${a.reason ? `<div class="appt-reason">Motivo: ${a.reason}</div>` : ""}
            </div>
            <div class="appt-actions">
              ${
                a.paymentId && a.status === "PENDING"
                  ? `<button type="button" class="btn btn-outline btn-sm" data-action="sync" data-id="${a.id}">🔄 Atualizar Asaas</button>
                     <button type="button" class="btn btn-secondary btn-sm" data-action="payinfo" data-id="${a.id}">💳 Ver Boleto/Pix</button>`
                  : ""
              }
              <a class="btn btn-outline btn-sm" href="${buildWhatsAppUrl(a)}" target="_blank" rel="noopener">📲 WhatsApp</a>
              <button type="button" class="btn btn-danger-outline btn-sm" data-action="delete" data-id="${a.id}" title="Remover">🗑️</button>
            </div>
          </article>`
          )
          .join("");
        return `<h2 class="date-group-title">📅 ${formatDateBr(date)}</h2>${cards}`;
      })
      .join("");
  }

  // --- Renderização do Banco de Dados de Planos (Titulares, Dependentes, Carências e Histórico) ---

  function renderPlanos() {
    $("badge-count-planos").textContent = contratos.filter((c) => c.status !== "CANCELED").length;
    const listEl = $("planos-list");
    const q = ($("search-planos").value || "").trim().toLowerCase();

    const filtered = contratos.filter((c) => {
      if (!q) return true;
      const matchTitular =
        (c.titularNome || "").toLowerCase().includes(q) || (c.titularCpf || "").includes(q);
      const matchDep = (c.dependentes || []).some(
        (d) => (d.nome || "").toLowerCase().includes(q) || (d.cpf || "").includes(q)
      );
      return matchTitular || matchDep;
    });

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="empty-state">Nenhum contrato encontrado. Clique em <strong>🌟 Novo Plano / Contrato</strong> no topo para cadastrar o titular e seus dependentes.</div>`;
      return;
    }

    listEl.innerHTML = filtered
      .map((c) => {
        const deps = c.dependentes || [];
        const totalVidas = 1 + deps.length;
        const isCanceled = c.status === "CANCELED";
        const linkBoleto = c.firstPaymentUrl || c.firstPaymentInvoiceUrl || "";
        const whatsUrl = buildBoletoWhatsAppUrl({
          phone: c.titularPhone,
          nome: c.titularNome,
          descricao: `${c.planName} (${totalVidas} vida(s))`,
          valor: c.valorMensal,
          vencimento: c.nextDueDate,
          link: linkBoleto,
        });

        // Calcula status das 4 carências para o titular deste contrato
        const carCons = evaluateCarenciaLocal({
          procedimento: "CONSULTA",
          dataAdesao: c.createdAt,
          totalVidas,
          regras: c.carenciasPersonalizadas,
        });
        const carEletro = evaluateCarenciaLocal({
          procedimento: "ELETRO_PREV",
          dataAdesao: c.createdAt,
          totalVidas,
          regras: c.carenciasPersonalizadas,
        });
        const carRaioX = evaluateCarenciaLocal({
          procedimento: "RAIO_X",
          dataAdesao: c.createdAt,
          totalVidas,
          regras: c.carenciasPersonalizadas,
        });
        const carLab = evaluateCarenciaLocal({
          procedimento: "EXAME_LAB",
          dataAdesao: c.createdAt,
          totalVidas,
          regras: c.carenciasPersonalizadas,
        });

        const badgeCar = (label, obj) =>
          obj.emCarencia
            ? `<span class="badge badge-amber">⏳ ${label}: libera ${formatDateBr(obj.liberaEm)} (faltam ${obj.diasRestantes}d)</span>`
            : `<span class="badge badge-green">✅ ${label}: Liberado</span>`;

        const depsHtml =
          deps.length === 0
            ? `<p class="muted" style="margin-top:0.5rem;">Nenhum dependente cadastrado (1 vida — carência de 30d para consultas).</p>`
            : `<div class="deps-table">
                ${deps
                  .map((d) => {
                    const carDepCons = evaluateCarenciaLocal({
                      procedimento: "CONSULTA",
                      dataAdesao: d.dataInclusao || c.createdAt,
                      totalVidas,
                      regras: c.carenciasPersonalizadas,
                    });
                    return `
                  <div class="dep-item">
                    <div>
                      <strong>👤 ${d.nome}</strong>
                      <span class="muted"> • CPF: ${formatCpf(d.cpf) || "Não inf."} • ${d.parentesco || "Dependente"} • Entrada: ${formatDateBr(d.dataInclusao || c.createdAt)}</span>
                      <span class="badge badge-teal" style="margin-left:0.3rem;">
                        ${d.tipoInclusao === "POSTERIOR" ? "Incluído depois (+R$ 60)" : "Adesão inicial"}
                      </span>
                      ${
                        carDepCons.emCarencia
                          ? `<span class="badge badge-amber">⏳ Consulta libera ${formatDateBr(carDepCons.liberaEm)}</span>`
                          : `<span class="badge badge-green">✅ Consulta Liberada</span>`
                      }
                    </div>
                    ${
                      !isCanceled
                        ? `<button type="button" class="btn btn-danger-outline btn-sm"
                            data-plan-action="remove-dep"
                            data-sub-id="${c.subscriptionId}"
                            data-dep-id="${d.id}">
                            🗑️ Retirar
                          </button>`
                        : ""
                    }
                  </div>`;
                  })
                  .join("")}
              </div>`;

        const historicoHtml = (c.historicoEventos || [])
          .slice(0, 6)
          .map((h) => `<div class="webhook-item"><small><strong>${formatDateBr(h.data)}:</strong> ${h.descricao}</small></div>`)
          .join("");

        return `
          <article class="appt-card ${isCanceled ? "status-REFUSED" : "status-CONFIRMED"}">
            <div class="appt-main">
              <div class="appt-top">
                <span class="badge ${isCanceled ? "badge-red" : "badge-green"}">
                  ${isCanceled ? "🚫 Contrato Cancelado (Em Quarentena 6m)" : "🪪 Contrato Ativo"}
                </span>
                <span class="badge badge-teal">${c.planName}</span>
                <span class="badge badge-amber">💰 Mensalidade Asaas: ${formatMoney(c.valorMensal)}/mês</span>
                <span class="muted">• <strong>${totalVidas} vida(s)</strong> (${totalVidas >= 3 ? "Zero carência p/ consultas" : "1-2 vidas: 30d carência p/ consultas"})</span>
                ${c.carenciasPersonalizadas ? `<span class="badge badge-teal">🔐 Carência Personalizada (Master)</span>` : ""}
              </div>

              <h3 class="appt-patient">${c.titularNome} <small class="muted">(CPF: ${formatCpf(c.titularCpf)} • WhatsApp: ${c.titularPhone || "-"})</small></h3>

              <p class="appt-meta">
                📜 <strong>Adesão:</strong> ${formatDateBr(c.createdAt)} •
                📅 <strong>Vencimento:</strong> ${formatDateBr(c.nextDueDate)} •
                📈 <strong>Próx. Reajuste Anual (+5%):</strong> ${formatDateBr(c.proximoReajusteEm || addYearsIso(c.createdAt, 1))}
                ${c.endDate ? ` • <strong>Validade:</strong> ${formatDateBr(c.endDate)}` : ""}
              </p>

              <div style="display:flex; flex-wrap:wrap; gap:0.35rem; margin-top:0.5rem;">
                ${badgeCar("Consultas", carCons)}
                ${badgeCar("Eletro/Prev (30d)", carEletro)}
                ${badgeCar("Raio-X (30d)", carRaioX)}
                ${badgeCar("Exames Lab (40d)", carLab)}
              </div>

              ${depsHtml}

              ${
                historicoHtml
                  ? `<details style="margin-top:0.65rem;">
                       <summary style="cursor:pointer; font-weight:600; font-size:0.86rem; color:var(--primary-dark);">
                         📜 Ver Histórico do Contrato (${(c.historicoEventos || []).length} registro(s))
                       </summary>
                       <div class="webhook-list" style="margin-top:0.4rem;">${historicoHtml}</div>
                     </details>`
                  : ""
              }
            </div>

            ${
              !isCanceled
                ? `<div class="appt-actions" style="align-self: flex-start; flex-direction: column; align-items: stretch;">
                    <button type="button" class="btn btn-primary btn-sm" data-plan-action="add-dep" data-sub-id="${c.subscriptionId}">
                      ➕ Incluir Dependente (+R$ 60 + R$ 10)
                    </button>
                    <button type="button" class="btn btn-teal-outline btn-sm" data-plan-action="edit-carencia" data-sub-id="${c.subscriptionId}">
                      🔐 Carências deste Contrato (Master)
                    </button>
                    <button type="button" class="btn btn-outline btn-sm" data-plan-action="annual-adjust" data-sub-id="${c.subscriptionId}">
                      📈 Aplicar Reajuste Anual (+5%)
                    </button>
                    <button type="button" class="btn btn-outline btn-sm" data-plan-action="edit-val" data-sub-id="${c.subscriptionId}">
                      ✏️ Alterar Mensalidade Asaas
                    </button>
                    <a class="btn btn-outline btn-sm" href="${whatsUrl}" target="_blank" rel="noopener">
                      📲 Enviar Boleto no WhatsApp
                    </a>
                    <button type="button" class="btn btn-danger-outline btn-sm" data-plan-action="cancel-contract" data-sub-id="${c.subscriptionId}">
                      🚫 Cancelar Plano (Quarentena 6m)
                    </button>
                  </div>`
                : ""
            }
          </article>
        `;
      })
      .join("");
  }

  function renderMasterView() {
    $("cfg-car-lab").value = regrasCarencia.examesLaboratoriaisDias ?? 40;
    $("cfg-car-eletro").value = regrasCarencia.eletroPreventivoDias ?? 30;
    $("cfg-car-raiox").value = regrasCarencia.raioXDias ?? 30;
    $("cfg-car-cons12").value = regrasCarencia.consulta1a2VidasDias ?? 30;
    $("cfg-car-cons3").value = regrasCarencia.consulta3MaisVidasDias ?? 0;
    $("cfg-car-quarentena").value = regrasCarencia.quarentenaSaidaMeses ?? 6;

    const qList = $("quarentena-list");
    if (!historicoSaidas || historicoSaidas.length === 0) {
      qList.innerHTML = `<div class="empty-state">Nenhum CPF em quarentena de 6 meses no momento.</div>`;
      return;
    }

    const today = getTodayIso();
    qList.innerHTML = historicoSaidas
      .map((h) => {
        const ativo = h.bloqueadoAte >= today;
        return `
          <div class="dep-item">
            <div>
              <strong>🚫 ${h.nome}</strong> (CPF: <code>${formatCpf(h.cpf)}</code>)
              <span class="badge ${ativo ? "badge-red" : "badge-green"}">
                ${ativo ? `Bloqueado até ${formatDateBr(h.bloqueadoAte)}` : `Liberado em ${formatDateBr(h.bloqueadoAte)}`}
              </span>
              <div class="muted">Saída em: ${formatDateBr(h.dataSaida)} • Motivo: ${h.motivo || "-"}</div>
            </div>
            <button type="button" class="btn btn-teal-outline btn-sm" data-remove-quarentena="${h.cpf}">
              🔐 Liberar CPF (Master)
            </button>
          </div>
        `;
      })
      .join("");
  }

  // --- Modais e Helpers ---

  function openModal(id) {
    $(id).classList.remove("hidden");
  }

  function closeModal(id) {
    $(id).classList.add("hidden");
  }

  function createDepRowElement(onRemove) {
    const row = document.createElement("div");
    row.className = "dep-row";
    row.innerHTML = `
      <input type="text" class="dep-input-name" placeholder="Nome completo do dependente *" required />
      <input type="text" class="dep-input-cpf" placeholder="CPF do dependente *" maxlength="14" required />
      <select class="dep-input-rel">
        <option value="Filho(a)">Filho(a)</option>
        <option value="Cônjuge">Cônjuge</option>
        <option value="Pai/Mãe">Pai/Mãe</option>
        <option value="Outro">Outro</option>
      </select>
      <button type="button" class="btn btn-danger-outline btn-sm" title="Remover linha">✕</button>
    `;
    const cpfInput = row.querySelector(".dep-input-cpf");
    cpfInput.addEventListener("input", (e) => {
      e.target.value = formatCpf(e.target.value);
    });
    row.querySelector("button").onclick = () => {
      row.remove();
      if (onRemove) onRemove();
    };
    return row;
  }

  function readDepsFromContainer(containerId) {
    const rows = $(containerId).querySelectorAll(".dep-row");
    const list = [];
    rows.forEach((r) => {
      const nome = r.querySelector(".dep-input-name")?.value.trim();
      const cpf = r.querySelector(".dep-input-cpf")?.value.trim();
      const parentesco = r.querySelector(".dep-input-rel")?.value;
      if (nome) list.push({ nome, cpf, parentesco });
    });
    return list;
  }

  function updateSubscriptionPriceSummary() {
    const plan = CFG.planos.find((p) => p.id === $("sub-plan").value);
    const valInput = $("sub-custom-value");
    const valorMensal = Number(valInput.value || 0);
    const taxaAdesao = REGRAS.taxaAdesaoFixa;
    const totalPagoNoAto = valorMensal + taxaAdesao;
    const mensalComDesconto = valorMensal * (1 - REGRAS.descontoPontualidadePct / 100);
    const depsCount = $("initial-deps-container").querySelectorAll(".dep-row").length;
    const totalVidas = 1 + depsCount;
    const startIso = $("sub-start-date").value || getTodayIso();
    const dueIso = $("sub-due-date").value || addMonthsIso(startIso, 1);

    $("sub-price-summary").innerHTML = `
      <div><strong>📋 Resumo do Contrato (${totalVidas} vida(s): Titular + ${depsCount} dependente(s)):</strong></div>
      <div>• <strong>💵 Pago no ato do contrato (1ª Mensalidade + Taxa de Adesão fixa de ${formatMoney(taxaAdesao)}):</strong> <strong>${formatMoney(totalPagoNoAto)}</strong></div>
      <div>• <strong>🧾 Mensalidades no Asaas (a partir do mês seguinte — 1º boleto em ${formatDateBr(dueIso)}):</strong> ${formatMoney(valorMensal)}/mês
        <em>(com 5% de desconto até o vencimento: <strong>${formatMoney(mensalComDesconto)}</strong>)</em>
      </div>
      <div>• <strong>📈 Reajuste anual (+5% no Asaas):</strong> em ${formatDateBr(addYearsIso(startIso, 1))}</div>
      <div>• <strong>⏱️ Carência Consultas (${totalVidas} vida(s)):</strong> <strong>${totalVidas >= 3 ? "✅ ZERO CARÊNCIA (Liberado imediato)" : "⏳ 30 dias"}</strong> • Eletro/Prev e Raio-X: 30d • Exames Lab: 40d</div>
      ${
        plan && plan.valor === null
          ? `<div style="margin-top:0.35rem; color:#92400e;">⚠️ <strong>${plan.nome}:</strong> informe no campo acima o valor mensal combinado para este contrato.</div>`
          : ""
      }
    `;
  }

  function autoSelectPlanByDepsCount() {
    const depsCount = $("initial-deps-container").querySelectorAll(".dep-row").length;
    const totalPessoas = 1 + depsCount;
    const currentPlan = CFG.planos.find((p) => p.id === $("sub-plan").value);

    if (totalPessoas <= 10 && (!currentPlan || currentPlan.categoria === "TABELA")) {
      const targetPlan = CFG.planos.find((p) => p.pessoas === totalPessoas && p.categoria === "TABELA");
      if (targetPlan) {
        $("sub-plan").value = targetPlan.id;
        $("sub-custom-value").value = targetPlan.valor.toFixed(2);
      }
    } else if (totalPessoas > 10 && currentPlan && currentPlan.categoria === "TABELA") {
      $("sub-plan").value = "plano-bronze";
      $("sub-custom-value").value = "";
      $("sub-custom-value").focus();
    }
    updateSubscriptionPriceSummary();
  }

  function showPaymentModal(appt) {
    const body = $("modal-payment-body");
    const whatsUrl = buildWhatsAppUrl(appt);
    body.innerHTML = `
      <p><strong>Paciente:</strong> ${appt.patientName}</p>
      <p><strong>Valor:</strong> ${formatMoney(appt.value)} • <strong>Status:</strong> ${appt.statusLabel}</p>
      <div class="price-summary-box">
        🎁 <strong>5% de desconto</strong> pagando até o vencimento (${formatDateBr(appt.date)}) •
        ⚠️ Após o vencimento: <strong>2% de multa + 2% de juros a.m.</strong>
      </div>
      ${
        appt.pixImage
          ? `<div class="pix-box">
               <p><strong>Escaneie o QR Code Pix (Asaas):</strong></p>
               <img src="data:image/png;base64,${appt.pixImage}" alt="QR Code Pix" />
             </div>`
          : ""
      }
      ${
        appt.pixPayload
          ? `<div class="pix-box">
               <p><strong>Pix Copia e Cola:</strong></p>
               <textarea class="pix-payload" rows="3" readonly id="pix-copy-text">${appt.pixPayload}</textarea>
               <button type="button" class="btn btn-primary btn-sm" id="btn-copy-pix">📋 Copiar Código Pix</button>
             </div>`
          : ""
      }
      <div class="form-row">
        ${
          appt.bankSlipUrl || appt.invoiceUrl
            ? `<a href="${appt.bankSlipUrl || appt.invoiceUrl}" target="_blank" rel="noopener" class="btn btn-primary">🧾 Abrir Boleto / Fatura Asaas</a>`
            : ""
        }
        <a href="${whatsUrl}" target="_blank" rel="noopener" class="btn btn-outline">📲 Enviar Boleto no WhatsApp</a>
      </div>
    `;
    openModal("modal-payment");

    const copyBtn = $("btn-copy-pix");
    if (copyBtn) {
      copyBtn.onclick = () => {
        navigator.clipboard?.writeText(appt.pixPayload);
        copyBtn.textContent = "✅ Copiado!";
      };
    }
  }

  // --- Verificação de Plano + Carência na Agenda ---

  async function runPlanVerification(masterOverride = false) {
    const cpf = $("appt-cpf").value;
    const procedimento = $("appt-procedure").value || "CONSULTA";
    const box = $("plan-check-result");
    box.classList.remove("hidden", "check-ok", "check-error");
    box.textContent = "⏳ Consultando pagamento no Asaas e calculando carência do procedimento...";

    const result = await apiVerificarPlano(cpf, procedimento, masterOverride);
    lastPlanCheck = result;

    if (result.customer?.name && !$("appt-name").value) {
      $("appt-name").value = result.customer.name;
    }

    if (result.autorizado) {
      box.classList.add("check-ok");
      box.innerHTML = `✅ <strong>${result.motivo}</strong>`;
    } else {
      box.classList.add("check-error");
      box.innerHTML = `
        <div>❌ <strong>${result.motivo}</strong></div>
        <div style="margin-top:0.6rem; display:flex; flex-wrap:wrap; gap:0.4rem;">
          ${
            result.bloqueioCarencia
              ? `<button type="button" id="btn-master-unlock-carencia" class="btn btn-teal-outline btn-sm">🔐 Liberar Carência (Senha Master)</button>`
              : ""
          }
          ${
            result.linkRegularizacao
              ? `<a href="${result.linkRegularizacao}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">🔗 Abrir Boleto/Fatura para Regularizar</a>`
              : ""
          }
          <button type="button" id="btn-switch-particular" class="btn btn-primary btn-sm">💳 Mudar para Particular</button>
          <button type="button" id="btn-log-refusal" class="btn btn-danger-outline btn-sm">🚫 Registrar Recusa na Agenda</button>
        </div>
      `;

      const unlockBtn = $("btn-master-unlock-carencia");
      if (unlockBtn) {
        unlockBtn.onclick = () => {
          if (requestMasterAuth(`Liberar carência de ${result.carencia?.nomeProcedimento || procedimento} para ${$("appt-name").value || cpf}`)) {
            runPlanVerification(true);
          }
        };
      }

      $("btn-switch-particular").onclick = () => {
        document.querySelector('input[name="appt-type"][value="PARTICULAR"]').checked = true;
        toggleTypePanels();
      };

      $("btn-log-refusal").onclick = () => {
        saveNewAppointment("REFUSED", result.motivo, result.linkRegularizacao || null);
      };
    }

    return result;
  }

  function saveNewAppointment(status, reason = null, invoiceUrl = null, extra = {}) {
    const profId = $("appt-professional").value;
    const prof = CFG.profissionais.find((p) => p.id === profId);
    const procId = $("appt-procedure").value;
    const proc = (CFG.procedimentos || []).find((p) => p.id === procId);
    const type = document.querySelector('input[name="appt-type"]:checked').value;

    const newAppt = {
      id: "apt-" + Date.now(),
      date: $("appt-date").value,
      time: $("appt-time").value,
      patientName: $("appt-name").value.trim() || "Paciente",
      cpf: formatCpf($("appt-cpf").value),
      phone: $("appt-phone").value.trim(),
      professionalId: profId,
      professionalName: prof ? `${prof.nome} (${prof.especialidade})` : profId,
      procedureId: procId,
      procedureName: proc ? proc.nome.split(" (")[0] : "Consulta Médica",
      type,
      status,
      statusLabel:
        status === "CONFIRMED"
          ? type === "PLANO"
            ? "Plano em Dia"
            : "Pago"
          : status === "PENDING"
          ? `Aguardando ${extra.billingType || "Pagamento"}`
          : "Recusada",
      value: type === "PARTICULAR" ? Number($("appt-value").value || 0) : 0,
      billingType: extra.billingType || null,
      paymentId: extra.paymentId || null,
      invoiceUrl: invoiceUrl || extra.invoiceUrl || null,
      bankSlipUrl: extra.bankSlipUrl || null,
      pixPayload: extra.pixPayload || null,
      pixImage: extra.pixImage || null,
      reason,
    };

    appointments.push(newAppt);
    saveAppointments();
    renderAgenda();
    closeModal("modal-appointment");
    return newAppt;
  }

  function toggleTypePanels() {
    const type = document.querySelector('input[name="appt-type"]:checked').value;
    $("section-plano").classList.toggle("hidden", type !== "PLANO");
    $("section-particular").classList.toggle("hidden", type !== "PARTICULAR");
    $("btn-submit-appt").textContent =
      type === "PLANO" ? "Verificar Plano/Carência e Confirmar" : "Gerar Cobrança Asaas e Agendar";
  }

  // --- Inicialização e Eventos ---

  function initSelects() {
    const procSelect = $("appt-procedure");
    (CFG.procedimentos || []).forEach((pr) => {
      procSelect.add(new Option(pr.nome, pr.id));
    });
    procSelect.onchange = () => {
      lastPlanCheck = null;
      if (!$("plan-check-result").classList.contains("hidden") && $("appt-cpf").value) {
        runPlanVerification(false);
      }
    };

    const profSelect = $("appt-professional");
    const filterProf = $("filter-professional");
    CFG.profissionais.forEach((p) => {
      profSelect.add(new Option(`${p.nome} — ${p.especialidade} (${formatMoney(p.valorParticular)})`, p.id));
      filterProf.add(new Option(`${p.nome} (${p.especialidade})`, p.id));
    });

    const syncProfPrice = () => {
      const p = CFG.profissionais.find((x) => x.id === profSelect.value);
      if (p) $("appt-value").value = p.valorParticular.toFixed(2);
    };
    profSelect.addEventListener("change", syncProfPrice);
    syncProfPrice();

    const planSelect = $("sub-plan");
    CFG.planos.forEach((pl) => {
      const label =
        pl.valor !== null
          ? `${pl.nome} — ${formatMoney(pl.valor)}/mês (+ R$ 10,00 adesão)`
          : `${pl.nome} — Valor personalizado`;
      planSelect.add(new Option(label, pl.id));
    });

    planSelect.onchange = () => {
      const pl = CFG.planos.find((x) => x.id === planSelect.value);
      if (pl && pl.valor !== null) {
        $("sub-custom-value").value = pl.valor.toFixed(2);
      } else {
        $("sub-custom-value").value = "";
        $("sub-custom-value").focus();
      }
      updateSubscriptionPriceSummary();
    };

    $("sub-custom-value").addEventListener("input", updateSubscriptionPriceSummary);
    $("sub-start-date").addEventListener("change", () => {
      const s = $("sub-start-date").value || getTodayIso();
      $("sub-due-date").value = addMonthsIso(s, 1);
      updateSubscriptionPriceSummary();
    });
    $("sub-due-date").addEventListener("change", updateSubscriptionPriceSummary);
  }

  function switchMainTab(tab) {
    ["agenda", "planos", "master"].forEach((t) => {
      $(`tab-btn-${t}`).classList.toggle("active", t === tab);
      $(`view-${t}`).classList.toggle("hidden", t !== tab);
    });
  }

  function initEvents() {
    $("tab-btn-agenda").onclick = () => switchMainTab("agenda");

    $("tab-btn-planos").onclick = async () => {
      switchMainTab("planos");
      await apiListarPlanosDb();
      renderPlanos();
    };

    $("tab-btn-master").onclick = async () => {
      switchMainTab("master");
      await apiListarPlanosDb();
      renderMasterView();
    };

    $("search-planos").addEventListener("input", renderPlanos);
    $("btn-refresh-planos").onclick = async () => {
      await apiListarPlanosDb();
      renderPlanos();
    };

    // Salvar Carências Globais (Master)
    $("form-global-carencias").onsubmit = async (e) => {
      e.preventDefault();
      if (!requestMasterAuth("Alterar as regras gerais de carência de todos os planos")) return;

      const novas = {
        examesLaboratoriaisDias: Number($("cfg-car-lab").value),
        eletroPreventivoDias: Number($("cfg-car-eletro").value),
        raioXDias: Number($("cfg-car-raiox").value),
        consulta1a2VidasDias: Number($("cfg-car-cons12").value),
        consulta3MaisVidasDias: Number($("cfg-car-cons3").value),
        quarentenaSaidaMeses: Number($("cfg-car-quarentena").value),
      };

      const res = await apiGerenciarPlano({
        action: "UPDATE_CARENCIAS_GLOBAL",
        regrasCarencia: novas,
      });
      if (res.ok) {
        alert(res.resumo);
        renderMasterView();
        renderPlanos();
      }
    };

    // Liberar CPF da Quarentena de 6 meses (Master)
    $("quarentena-list").onclick = async (e) => {
      const btn = e.target.closest("[data-remove-quarentena]");
      if (!btn) return;
      const cpf = btn.dataset.removeQuarentena;
      if (!requestMasterAuth(`Remover bloqueio de 6 meses do CPF ${formatCpf(cpf)}`)) return;

      const res = await apiGerenciarPlano({
        action: "REMOVE_QUARANTINE",
        cpf,
      });
      if (res.ok) {
        alert(res.resumo);
        renderMasterView();
      }
    };

    // Fonte A- / A+
    let fontSize = Number(localStorage.getItem(FONT_KEY) || 16);
    document.documentElement.style.fontSize = `${fontSize}px`;
    $("btn-font-inc").onclick = () => {
      fontSize = Math.min(22, fontSize + 1);
      document.documentElement.style.fontSize = `${fontSize}px`;
      localStorage.setItem(FONT_KEY, fontSize);
    };
    $("btn-font-dec").onclick = () => {
      fontSize = Math.max(13, fontSize - 1);
      document.documentElement.style.fontSize = `${fontSize}px`;
      localStorage.setItem(FONT_KEY, fontSize);
    };

    // Filtros da Agenda
    document.querySelectorAll(".filter-chip").forEach((btn) => {
      btn.onclick = () => {
        document.querySelectorAll(".filter-chip").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentFilter = btn.dataset.filter;
        renderAgenda();
      };
    });
    $("filter-professional").onchange = (e) => {
      currentProfFilter = e.target.value;
      renderAgenda();
    };
    $("btn-print").onclick = () => window.print();

    document.querySelectorAll("[data-close]").forEach((el) => {
      el.onclick = () => closeModal(el.dataset.close);
    });

    // Abrir Nova Consulta
    $("btn-new-appointment").onclick = () => {
      $("form-appointment").reset();
      $("appt-date").value = getTodayIso();
      $("plan-check-result").classList.add("hidden");
      lastPlanCheck = null;
      const p = CFG.profissionais[0];
      if (p) $("appt-value").value = p.valorParticular.toFixed(2);
      toggleTypePanels();
      openModal("modal-appointment");
    };

    document.querySelectorAll(".hint-btn").forEach((btn) => {
      btn.onclick = () => {
        $("appt-cpf").value = btn.dataset.cpf;
        const clean = sanitizeDoc(btn.dataset.cpf);
        const cli = CFG.demoClientesAsaas[clean];
        if (cli) {
          $("appt-name").value = cli.name;
          $("appt-phone").value = cli.phone;
        }
        runPlanVerification(false);
      };
    });

    $("appt-cpf").addEventListener("input", (e) => {
      e.target.value = formatCpf(e.target.value);
      lastPlanCheck = null;
    });

    document.querySelectorAll('input[name="appt-type"]').forEach((r) => {
      r.addEventListener("change", toggleTypePanels);
    });

    $("btn-verify-plan").onclick = () => runPlanVerification(false);

    // Submit Consulta
    $("form-appointment").onsubmit = async (e) => {
      e.preventDefault();
      const type = document.querySelector('input[name="appt-type"]:checked').value;

      if (type === "PLANO") {
        const check = lastPlanCheck || (await runPlanVerification(false));
        if (!check.autorizado) return;
        saveNewAppointment("CONFIRMED");
        return;
      }

      const btn = $("btn-submit-appt");
      btn.disabled = true;
      btn.textContent = "⏳ Gerando cobrança no Asaas...";

      try {
        const profId = $("appt-professional").value;
        const prof = CFG.profissionais.find((p) => p.id === profId);
        const billingType = $("appt-billing").value;
        const resp = await apiCriarCobranca({
          name: $("appt-name").value.trim(),
          cpfCnpj: $("appt-cpf").value,
          phone: $("appt-phone").value,
          value: $("appt-value").value,
          dueDate: $("appt-date").value,
          billingType,
          description: `Atendimento ${prof ? prof.nome : ""} - ${formatDateBr($("appt-date").value)}`,
        });

        if (!resp.ok) {
          alert(`Erro Asaas: ${resp.error || "Não foi possível gerar a cobrança."}`);
          return;
        }

        const saved = saveNewAppointment("PENDING", null, resp.payment.invoiceUrl, {
          billingType,
          paymentId: resp.payment.id,
          invoiceUrl: resp.payment.invoiceUrl,
          bankSlipUrl: resp.payment.bankSlipUrl,
          pixPayload: resp.pix?.payload || null,
          pixImage: resp.pix?.encodedImage || null,
        });
        showPaymentModal(saved);
      } finally {
        btn.disabled = false;
        toggleTypePanels();
      }
    };

    // Ações nos cards da agenda
    $("agenda-list").onclick = async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const id = btn.dataset.id;
      const appt = appointments.find((a) => a.id === id);
      if (!appt) return;

      if (btn.dataset.action === "delete") {
        if (confirm(`Remover agendamento de ${appt.patientName}?`)) {
          appointments = appointments.filter((a) => a.id !== id);
          saveAppointments();
          renderAgenda();
        }
      } else if (btn.dataset.action === "payinfo") {
        showPaymentModal(appt);
      } else if (btn.dataset.action === "sync") {
        btn.disabled = true;
        btn.textContent = "⏳...";
        const res = await apiConsultarCobranca(appt.paymentId);
        if (res.ok && res.payment) {
          const st = res.payment.status;
          if (st === "RECEIVED" || st === "CONFIRMED" || st === "RECEIVED_IN_CASH") {
            appt.status = "CONFIRMED";
            appt.statusLabel = `Pago (${appt.billingType || "Asaas"})`;
            saveAppointments();
          } else if (st === "OVERDUE") {
            appt.statusLabel = "Fatura Vencida";
            saveAppointments();
          } else {
            alert(`Status atual no Asaas: ${st}`);
          }
          renderAgenda();
        } else {
          alert(res.error || "Erro ao consultar Asaas.");
          btn.disabled = false;
          btn.textContent = "🔄 Atualizar Asaas";
        }
      }
    };

    // --- Modal: Novo Plano / Contrato ---
    $("btn-new-subscription").onclick = () => {
      $("form-subscription").reset();
      $("initial-deps-container").innerHTML = "";
      const today = getTodayIso();
      $("sub-start-date").value = today;
      $("sub-due-date").value = addMonthsIso(today, 1); // 1º vencimento do Asaas no mês seguinte!
      $("sub-end-date").value = "";
      $("sub-plan").value = CFG.planos[0].id;
      $("sub-custom-value").value = CFG.planos[0].valor.toFixed(2);
      $("sub-result").classList.add("hidden");
      updateSubscriptionPriceSummary();
      openModal("modal-subscription");
    };

    $("btn-add-initial-dep").onclick = () => {
      const row = createDepRowElement(autoSelectPlanByDepsCount);
      $("initial-deps-container").appendChild(row);
      autoSelectPlanByDepsCount();
    };

    $("sub-cpf").addEventListener("input", (e) => {
      e.target.value = formatCpf(e.target.value);
    });

    async function submitSubscription(masterOverride = false) {
      const plan = CFG.planos.find((p) => p.id === $("sub-plan").value);
      const valorMensal = Number($("sub-custom-value").value);
      const dataAdesao = $("sub-start-date").value || getTodayIso();
      const nextDueDate = $("sub-due-date").value || getTodayIso();
      const endDate = $("sub-end-date").value || undefined;
      const dependentes = readDepsFromContainer("initial-deps-container");

      if (!valorMensal || valorMensal <= 0) {
        alert("Informe o valor mensal do plano.");
        return;
      }

      const box = $("sub-result");
      box.classList.remove("hidden", "check-ok", "check-error");
      box.textContent = "⏳ Criando assinatura no Asaas e verificando regras...";

      const res = await apiCriarAssinatura({
        name: $("sub-name").value.trim(),
        cpfCnpj: $("sub-cpf").value,
        phone: $("sub-phone").value,
        planId: plan ? plan.id : "custom",
        planCategory: plan ? plan.categoria : "CUSTOM",
        value: valorMensal,
        taxaAdesao: REGRAS.taxaAdesaoFixa,
        cycle: "MONTHLY",
        billingType: $("sub-billing").value,
        description: plan ? plan.nome : "Plano da Clínica",
        dataAdesao,
        nextDueDate,
        endDate,
        dependentes,
        masterOverride,
      });

      if (res.ok) {
        if (res.contrato) {
          contratos = contratos.filter((c) => c.subscriptionId !== res.contrato.subscriptionId);
          contratos.unshift(res.contrato);
          saveContratosLocal();
          renderPlanos();
        }
        box.classList.add("check-ok");
        const linkBoleto = res.firstPayment?.bankSlipUrl || res.firstPayment?.invoiceUrl;
        const valorPagoAto = valorMensal + REGRAS.taxaAdesaoFixa;
        const whatsUrl = buildBoletoWhatsAppUrl({
          phone: $("sub-phone").value,
          nome: $("sub-name").value.trim(),
          descricao: `${plan ? plan.nome : "Plano"} (Mensalidade Asaas - Venc. ${formatDateBr(nextDueDate)})`,
          valor: valorMensal,
          vencimento: nextDueDate,
          link: linkBoleto,
        });

        box.innerHTML = `
          ✅ <strong>Contrato criado e salvo com ${1 + dependentes.length} vida(s)!</strong><br>
          💵 <strong>Recebido no ato do contrato (1ª mensalidade + R$ 10,00 adesão):</strong> ${formatMoney(valorPagoAto)}<br>
          🧾 <strong>Mensalidades no Asaas (a partir do mês seguinte):</strong> ${formatMoney(valorMensal)}/mês •
          <strong>1º Vencimento Asaas:</strong> ${formatDateBr(nextDueDate)} (5% de desconto até o vencimento)<br>
          <div style="margin-top:0.6rem; display:flex; flex-wrap:wrap; gap:0.5rem;">
            ${
              linkBoleto
                ? `<a href="${linkBoleto}" target="_blank" rel="noopener" class="btn btn-primary btn-sm">🧾 Abrir Boleto do Mês Seguinte (Asaas)</a>`
                : ""
            }
            <a href="${whatsUrl}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">📲 Enviar Boleto no WhatsApp</a>
          </div>
        `;
      } else {
        box.classList.add("check-error");
        box.innerHTML = `
          <div>❌ <strong>${res.error || "Erro ao criar assinatura."}</strong></div>
          ${
            res.bloqueioQuarentena
              ? `<button type="button" id="btn-master-override-sub" class="btn btn-teal-outline btn-sm" style="margin-top:0.5rem;">
                   🔐 Passar por Cima da Regra de 6 Meses (Senha Master)
                 </button>`
              : ""
          }
        `;
        const overBtn = $("btn-master-override-sub");
        if (overBtn) {
          overBtn.onclick = () => {
            if (requestMasterAuth("Autorizar adesão de CPF em quarentena de 6 meses")) {
              submitSubscription(true);
            }
          };
        }
      }
    }

    $("form-subscription").onsubmit = (e) => {
      e.preventDefault();
      submitSubscription(false);
    };

    // --- Ações nos Cards de Planos ---
    function updatePostDepCalcBox() {
      const subId = $("add-dep-sub-id").value;
      const contrato = contratos.find((c) => c.subscriptionId === subId);
      if (!contrato) return;
      const qtd = Math.max(1, $("post-deps-container").querySelectorAll(".dep-row").length);
      const acrescimoMensal = qtd * REGRAS.valorDependentePosterior;
      const valorImediato = acrescimoMensal + REGRAS.taxaAdesaoFixa;
      const novaMensalidade = Number(contrato.valorMensal) + acrescimoMensal;

      $("add-dep-calc-box").innerHTML = `
        <strong>⚡ Atualização Automática no Asaas (${qtd} novo(s) dependente(s)):</strong><br>
        • <strong>Cobrança imediata gerada agora:</strong> ${formatMoney(valorImediato)}
          (${qtd}x ${formatMoney(REGRAS.valorDependentePosterior)} + ${formatMoney(REGRAS.taxaAdesaoFixa)} taxa fixa de adesão)<br>
        • <strong>Nova mensalidade da assinatura no Asaas:</strong> passa de ${formatMoney(contrato.valorMensal)} para <strong>${formatMoney(novaMensalidade)}/mês</strong>
      `;
    }

    $("btn-more-post-dep").onclick = () => {
      const row = createDepRowElement(updatePostDepCalcBox);
      $("post-deps-container").appendChild(row);
      updatePostDepCalcBox();
    };

    $("planos-list").onclick = async (e) => {
      const btn = e.target.closest("[data-plan-action]");
      if (!btn) return;
      const subId = btn.dataset.subId;
      const contrato = contratos.find((c) => c.subscriptionId === subId);
      if (!contrato) return;

      const act = btn.dataset.planAction;

      if (act === "add-dep") {
        $("add-dep-sub-id").value = subId;
        $("add-dep-contract-info").innerHTML = `
          <strong>Titular:</strong> ${contrato.titularNome} (CPF: ${formatCpf(contrato.titularCpf)}) •
          <strong>Mensalidade atual:</strong> ${formatMoney(contrato.valorMensal)}/mês
        `;
        $("post-deps-container").innerHTML = "";
        $("post-deps-container").appendChild(createDepRowElement(updatePostDepCalcBox));
        $("add-dep-due-date").value = getTodayIso();
        $("add-dep-result").classList.add("hidden");
        updatePostDepCalcBox();
        openModal("modal-add-dep");
      }

      if (act === "remove-dep") {
        const depId = btn.dataset.depId;
        const dep = (contrato.dependentes || []).find((d) => d.id === depId);
        if (!dep) return;

        $("rem-dep-sub-id").value = subId;
        $("rem-dep-id").value = depId;
        $("rem-dep-info").innerHTML = `
          Retirar o dependente <strong>${dep.nome}</strong> do contrato de <strong>${contrato.titularNome}</strong>
          (mensalidade atual: <strong>${formatMoney(contrato.valorMensal)}/mês</strong>).
        `;
        $("rem-dep-decrease-check").checked = true;
        $("rem-dep-new-val-box").classList.remove("hidden");

        const sugerido = Math.max(120, Number(contrato.valorMensal) - REGRAS.valorDependentePosterior);
        $("rem-dep-new-value").value = sugerido.toFixed(2);
        $("rem-dep-hint").textContent = `Sugestão automática: ${formatMoney(sugerido)} (redução de R$ 60,00). Você pode digitar qualquer valor.`;
        openModal("modal-remove-dep");
      }

      if (act === "edit-carencia") {
        if (!requestMasterAuth(`Alterar carências específicas do contrato de ${contrato.titularNome}`)) return;
        const r = { ...regrasCarencia, ...(contrato.carenciasPersonalizadas || {}) };
        $("cc-sub-id").value = subId;
        $("cc-contract-title").textContent = `Contrato de ${contrato.titularNome} (CPF: ${formatCpf(contrato.titularCpf)})`;
        $("cc-lab").value = r.examesLaboratoriaisDias ?? 40;
        $("cc-eletro").value = r.eletroPreventivoDias ?? 30;
        $("cc-raiox").value = r.raioXDias ?? 30;
        $("cc-cons12").value = r.consulta1a2VidasDias ?? 30;
        $("cc-cons3").value = r.consulta3MaisVidasDias ?? 0;
        openModal("modal-contract-carencia");
      }

      if (act === "annual-adjust") {
        const novo = Number((Number(contrato.valorMensal) * 1.05).toFixed(2));
        if (
          !confirm(
            `Aplicar reajuste anual de +5% no contrato de ${contrato.titularNome}?\n\nDe: ${formatMoney(contrato.valorMensal)}/mês\nPara: ${formatMoney(novo)}/mês\n\nO valor será atualizado automaticamente na assinatura do Asaas.`
          )
        ) {
          return;
        }
        const res = await apiGerenciarPlano({
          action: "APPLY_ANNUAL_ADJUSTMENT",
          subscriptionId: subId,
          percentual: 5,
        });
        if (res.ok) {
          alert(res.resumo);
          renderPlanos();
        } else {
          alert(res.error || "Erro ao aplicar reajuste.");
        }
      }

      if (act === "cancel-contract") {
        if (
          !confirm(
            `🚫 Cancelar o plano de ${contrato.titularNome} no Asaas?\n\nO titular e todos os dependentes ficarão registrados com carência de 6 meses sem poder reativar ou entrar em outro plano (exceto com Senha Master).`
          )
        ) {
          return;
        }
        const res = await apiGerenciarPlano({
          action: "CANCEL_CONTRACT",
          subscriptionId: subId,
        });
        if (res.ok) {
          alert(res.resumo);
          renderPlanos();
        } else {
          alert(res.error || "Erro ao cancelar contrato.");
        }
      }

      if (act === "edit-val") {
        const input = prompt(
          `Informe o novo valor mensal da assinatura de ${contrato.titularNome} no Asaas (atual: ${formatMoney(contrato.valorMensal)}):`,
          contrato.valorMensal
        );
        if (!input) return;
        const novoValor = Number(String(input).replace(",", "."));
        if (!novoValor || novoValor <= 0) {
          alert("Valor inválido.");
          return;
        }
        const res = await apiGerenciarPlano({
          action: "UPDATE_VALUE",
          subscriptionId: subId,
          novoValorMensal: novoValor,
        });
        if (res.ok) {
          alert(res.resumo);
          renderPlanos();
        } else {
          alert(res.error || "Erro ao atualizar valor no Asaas.");
        }
      }
    };

    // Modal de Carências Específicas do Contrato (Master)
    $("btn-cc-zero-all").onclick = () => {
      $("cc-lab").value = 0;
      $("cc-eletro").value = 0;
      $("cc-raiox").value = 0;
      $("cc-cons12").value = 0;
      $("cc-cons3").value = 0;
    };

    $("btn-cc-restore-default").onclick = async () => {
      const subId = $("cc-sub-id").value;
      const res = await apiGerenciarPlano({
        action: "UPDATE_CARENCIAS_CONTRATO",
        subscriptionId: subId,
        carenciasPersonalizadas: null,
      });
      if (res.ok) {
        closeModal("modal-contract-carencia");
        renderPlanos();
        alert(res.resumo);
      }
    };

    $("form-contract-carencia").onsubmit = async (e) => {
      e.preventDefault();
      const subId = $("cc-sub-id").value;
      const custom = {
        examesLaboratoriaisDias: Number($("cc-lab").value),
        eletroPreventivoDias: Number($("cc-eletro").value),
        raioXDias: Number($("cc-raiox").value),
        consulta1a2VidasDias: Number($("cc-cons12").value),
        consulta3MaisVidasDias: Number($("cc-cons3").value),
      };
      const res = await apiGerenciarPlano({
        action: "UPDATE_CARENCIAS_CONTRATO",
        subscriptionId: subId,
        carenciasPersonalizadas: custom,
      });
      if (res.ok) {
        closeModal("modal-contract-carencia");
        renderPlanos();
        alert(res.resumo);
      }
    };

    $("rem-dep-decrease-check").onchange = (e) => {
      $("rem-dep-new-val-box").classList.toggle("hidden", !e.target.checked);
    };

    // Inclusão Posterior de Dependente (com suporte a Override Master para quarentena de 6 meses)
    async function submitAddDependent(masterOverride = false) {
      const subId = $("add-dep-sub-id").value;
      const contrato = contratos.find((c) => c.subscriptionId === subId);
      const dependentes = readDepsFromContainer("post-deps-container");
      if (dependentes.length === 0) {
        alert("Informe os dados do dependente.");
        return;
      }

      const btn = $("btn-submit-add-dep");
      btn.disabled = true;
      const box = $("add-dep-result");
      box.classList.remove("hidden", "check-ok", "check-error");
      box.textContent = "⏳ Atualizando assinatura e gerando boleto no Asaas...";

      try {
        const res = await apiGerenciarPlano({
          action: "ADD_DEPENDENTS",
          subscriptionId: subId,
          dependentes,
          dueDate: $("add-dep-due-date").value,
          billingType: $("add-dep-billing").value,
          masterOverride,
        });

        if (res.ok) {
          renderPlanos();
          box.classList.add("check-ok");
          const cob = res.cobrancaAdesao;
          const link = cob?.bankSlipUrl || cob?.invoiceUrl;
          const whatsUrl = buildBoletoWhatsAppUrl({
            phone: contrato?.titularPhone,
            nome: contrato?.titularNome,
            descricao: `Inclusão de ${dependentes.length} dependente(s) no plano`,
            valor: cob?.value,
            vencimento: cob?.dueDate,
            link,
          });

          box.innerHTML = `
            ✅ <strong>${res.resumo}</strong>
            <div style="margin-top:0.6rem; display:flex; flex-wrap:wrap; gap:0.5rem;">
              ${link ? `<a href="${link}" target="_blank" rel="noopener" class="btn btn-primary btn-sm">🧾 Abrir Boleto (${formatMoney(cob.value)})</a>` : ""}
              <a href="${whatsUrl}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">📲 Enviar Boleto no WhatsApp</a>
            </div>
          `;
        } else {
          box.classList.add("check-error");
          box.innerHTML = `
            <div>❌ <strong>${res.error || "Erro ao incluir dependente."}</strong></div>
            ${
              res.bloqueioQuarentena
                ? `<button type="button" id="btn-master-override-dep" class="btn btn-teal-outline btn-sm" style="margin-top:0.5rem;">
                     🔐 Passar por Cima da Regra de 6 Meses (Senha Master)
                   </button>`
                : ""
            }
          `;
          const overBtn = $("btn-master-override-dep");
          if (overBtn) {
            overBtn.onclick = () => {
              if (requestMasterAuth("Autorizar inclusão de dependente em quarentena de 6 meses")) {
                submitAddDependent(true);
              }
            };
          }
        }
      } finally {
        btn.disabled = false;
      }
    }

    $("form-add-dep").onsubmit = (e) => {
      e.preventDefault();
      submitAddDependent(false);
    };

    $("form-remove-dep").onsubmit = async (e) => {
      e.preventDefault();
      const subId = $("rem-dep-sub-id").value;
      const depId = $("rem-dep-id").value;
      const diminuir = $("rem-dep-decrease-check").checked;
      const novoValor = Number($("rem-dep-new-value").value);

      const btn = $("btn-submit-rem-dep");
      btn.disabled = true;
      try {
        const res = await apiGerenciarPlano({
          action: "REMOVE_DEPENDENT",
          subscriptionId: subId,
          dependenteId: depId,
          diminuirMensalidade: diminuir,
          novoValorMensal: novoValor,
        });
        if (res.ok) {
          closeModal("modal-remove-dep");
          renderPlanos();
          alert(res.resumo);
        } else {
          alert(res.error || "Erro ao remover dependente.");
        }
      } finally {
        btn.disabled = false;
      }
    };

    // Área da Recepção / Admin
    $("btn-open-admin").onclick = () => openModal("modal-admin");
    $("btn-admin-login").onclick = () => {
      const val = $("admin-pin-input").value;
      if (val === CFG.pinRecepcao || val === CFG.pinMaster) {
        $("admin-login-box").classList.add("hidden");
        $("admin-panel-box").classList.remove("hidden");
        $("admin-env-status").textContent = isLiveMode()
          ? "Atualmente usando: Asaas Real (Netlify Functions)."
          : "Atualmente usando: Modo Demonstração Local (dados fictícios).";
      } else {
        alert("PIN incorreto.");
      }
    };

    $("btn-mode-demo").onclick = () => {
      localStorage.setItem(MODE_KEY, "demo");
      updateModeUI();
      $("admin-env-status").textContent = "Atualmente usando: Modo Demonstração Local.";
    };

    $("btn-mode-netlify").onclick = () => {
      localStorage.setItem(MODE_KEY, "netlify");
      updateModeUI();
      $("admin-env-status").textContent = "Atualmente usando: Asaas Real (Netlify Functions).";
    };

    $("btn-refresh-webhooks").onclick = async () => {
      const list = $("webhook-events-list");
      if (!isLiveMode()) {
        list.innerHTML = `<div class="webhook-item">No Modo Demo, webhooks reais ficam ativos após publicar no Netlify.</div>`;
        return;
      }
      const res = await fetch("/.netlify/functions/asaas-webhook-eventos").then((r) => r.json());
      if (!res.events || res.events.length === 0) {
        list.innerHTML = `<div class="webhook-item">Nenhum evento recebido ainda.</div>`;
        return;
      }
      list.innerHTML = res.events
        .map(
          (ev) =>
            `<div class="webhook-item"><strong>${ev.event}</strong> • Pagto: ${ev.paymentId || "-"} (${ev.paymentStatus || "-"}) • ${ev.receivedAt}</div>`
        )
        .join("");
    };

    $("btn-export-json").onclick = () => {
      const blob = new Blob([JSON.stringify({ appointments, contratos, regrasCarencia, historicoSaidas }, null, 2)], {
        type: "application/json",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `clinica-dados-${getTodayIso()}.json`;
      a.click();
    };

    $("btn-reset-demo").onclick = () => {
      if (confirm("Restaurar os dados de exemplo?")) {
        appointments = seedDemoAppointments();
        contratos = seedDemoContratos();
        historicoSaidas = [];
        saveAppointments();
        saveContratosLocal();
        renderAgenda();
        renderPlanos();
      }
    };
  }

  $("clinic-name").textContent = CFG.nomeClinica;
  $("clinic-subtitle").textContent = CFG.subtitulo;
  updateModeUI();
  initSelects();
  loadContratosLocal();
  loadAppointments();
  renderAgenda();
  renderPlanos();
  initEvents();

  if (isLiveMode()) {
    apiListarPlanosDb().then(() => renderPlanos());
  }
})();
