(() => {
  const CFG = window.CLINICA_CONFIG;
  const STORAGE_KEY = "clinica_asaas_appointments_v1";
  const MODE_KEY = "clinica_asaas_mode_v1";
  const FONT_KEY = "clinica_asaas_font_px_v1";

  let appointments = [];
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
    return v;
  }

  function formatMoney(v) {
    return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function formatDateBr(isoDate) {
    if (!isoDate) return "";
    const [y, m, d] = isoDate.split("-");
    return `${d}/${m}/${y}`;
  }

  function getTodayIso() {
    const now = new Date();
    const off = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - off).toISOString().slice(0, 10);
  }

  function isLiveMode() {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === "netlify") return true;
    if (saved === "demo") return false;
    if (CFG.modoIntegracao === "netlify") return true;
    if (CFG.modoIntegracao === "demo") return false;
    return window.location.protocol.startsWith("http") && !window.location.hostname.includes("localhost")
      ? true
      : window.location.port === "8888"; // porta padrão do netlify dev
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

  // --- Camada de API (Alterna entre Netlify Functions reais e Simulação Demo) ---

  async function apiVerificarPlano(cpf) {
    const clean = sanitizeDoc(cpf);
    if (!isLiveMode()) {
      const cli = CFG.demoClientesAsaas[clean];
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
          motivo: `Agendamento recusado: paciente possui ${cli.faturasVencidas.length} fatura(s) vencida(s) no Asaas (total ${formatMoney(fat.value)}, vencimento em ${formatDateBr(fat.dueDate)}).`,
          customer: { id: cli.id, name: cli.name, cpfCnpj: cli.cpfCnpj },
          faturasVencidas: cli.faturasVencidas,
          linkRegularizacao: fat.invoiceUrl,
        };
      }
      if (cli.situacao !== "EM_DIA" || !cli.plano) {
        return {
          autorizado: false,
          statusPlano: "SEM_PLANO_ATIVO",
          motivo: "Agendamento pelo plano recusado: nenhuma assinatura de plano ativa encontrada para este CPF.",
          customer: { id: cli.id, name: cli.name, cpfCnpj: cli.cpfCnpj },
        };
      }
      return {
        autorizado: true,
        statusPlano: "EM_DIA",
        motivo: `Plano em dia! Assinatura "${cli.plano.description}" ativa (próximo vencimento: ${formatDateBr(cli.plano.nextDueDate)}).`,
        customer: { id: cli.id, name: cli.name, cpfCnpj: cli.cpfCnpj },
        plano: cli.plano,
      };
    }

    const res = await fetch(`/.netlify/functions/asaas-verificar-plano?cpf=${encodeURIComponent(clean)}`);
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
              payload: `00020126580014BR.GOV.BCB.PIX0136demo-asaas-${id}5204000053039865406${Number(payload.value).toFixed(2)}5802BR5915CLINICA VIDA6009SAO PAULO62070503***6304ABCD`,
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

  async function apiCriarAssinatura(payload) {
    if (!isLiveMode()) {
      const clean = sanitizeDoc(payload.cpfCnpj);
      const subId = "sub_demo_" + Math.random().toString(36).slice(2, 8);
      CFG.demoClientesAsaas[clean] = {
        id: "cus_demo_" + clean.slice(0, 4),
        name: payload.name,
        cpfCnpj: clean,
        phone: payload.phone,
        situacao: "EM_DIA",
        plano: {
          id: subId,
          description: payload.description,
          value: Number(payload.value),
          cycle: "MONTHLY",
          nextDueDate: getTodayIso(),
          status: "ACTIVE",
        },
        faturasVencidas: [],
      };
      return {
        ok: true,
        subscription: { id: subId, status: "ACTIVE", value: payload.value, description: payload.description },
        firstPayment: { id: "pay_demo_first", status: "PENDING", invoiceUrl: `https://sandbox.asaas.com/i/${subId}` },
      };
    }

    const res = await fetch("/.netlify/functions/asaas-criar-assinatura", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.json();
  }

  async function apiConsultarCobranca(paymentId) {
    if (!isLiveMode()) {
      return { ok: true, payment: { id: paymentId, status: "RECEIVED" } };
    }
    const res = await fetch(`/.netlify/functions/asaas-consultar-cobranca?id=${encodeURIComponent(paymentId)}`);
    return res.json();
  }

  // --- Persistência Local ---

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
        type: "PLANO",
        status: "CONFIRMED",
        statusLabel: "Plano em Dia",
        value: 0,
        billingType: null,
        paymentId: null,
        invoiceUrl: null,
        reason: null,
      },
      {
        id: "apt-2",
        date: today,
        time: "10:30",
        patientName: "Fernanda Souza",
        cpf: "333.333.333-33",
        phone: "11999993333",
        professionalId: "dra-ana",
        professionalName: "Dra. Ana Paula (Cardiologia)",
        type: "PARTICULAR",
        status: "PENDING",
        statusLabel: "Aguardando Pix",
        value: 350.0,
        billingType: "PIX",
        paymentId: "pay_demo_inicial",
        invoiceUrl: "https://sandbox.asaas.com/i/pay_demo_inicial",
        pixPayload: "00020126580014BR.GOV.BCB.PIX0136demo-asaas-pay_demo_inicial5204000053039865406350.00",
        reason: null,
      },
      {
        id: "apt-3",
        date: today,
        time: "14:00",
        patientName: "João Pedro Oliveira",
        cpf: "222.222.222-22",
        phone: "11999992222",
        professionalId: "dr-rafael",
        professionalName: "Dr. Rafael Lima (Ortopedia)",
        type: "PLANO",
        status: "REFUSED",
        statusLabel: "Recusada (Inadimplente)",
        value: 0,
        billingType: null,
        paymentId: null,
        invoiceUrl: "https://sandbox.asaas.com/i/demo-fatura-vencida-01",
        reason: "Fatura vencida no Asaas em 15/10/2026 (R$ 289,00).",
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

  // --- Renderização ---

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
    let msg = "";
    if (appt.status === "REFUSED") {
      msg = `Olá ${appt.patientName}! Notamos uma pendência no seu plano da ${CFG.nomeClinica}: ${appt.reason} Para regularizar e liberar seu agendamento, acesse: ${appt.invoiceUrl || "entre em contato com a recepção."}`;
    } else if (appt.status === "PENDING" && appt.invoiceUrl) {
      msg = `Olá ${appt.patientName}! Sua consulta com ${appt.professionalName} em ${formatDateBr(appt.date)} às ${appt.time} está pré-agendada. Valor: ${formatMoney(appt.value)}. Link para pagamento Asaas: ${appt.invoiceUrl}`;
    } else {
      msg = `Olá ${appt.patientName}! Confirmamos sua consulta na ${CFG.nomeClinica} com ${appt.professionalName} no dia ${formatDateBr(appt.date)} às ${appt.time}.`;
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
      listEl.innerHTML = `<div class="empty-state">Nenhuma consulta encontrada para este filtro. Clique em <strong>+ Nova Consulta</strong> para agendar.</div>`;
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
              </div>
              <h3 class="appt-patient">${a.patientName} <small class="muted">(${maskCpf(a.cpf)})</small></h3>
              <p class="appt-meta">${a.professionalName}</p>
              ${a.reason ? `<div class="appt-reason">Motivo da recusa: ${a.reason}</div>` : ""}
            </div>
            <div class="appt-actions">
              ${
                a.paymentId && a.status === "PENDING"
                  ? `<button type="button" class="btn btn-outline btn-sm" data-action="sync" data-id="${a.id}">🔄 Atualizar Asaas</button>
                     <button type="button" class="btn btn-secondary btn-sm" data-action="payinfo" data-id="${a.id}">💳 Ver Cobrança</button>`
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

  // --- Modais ---

  function openModal(id) {
    $(id).classList.remove("hidden");
  }

  function closeModal(id) {
    $(id).classList.add("hidden");
  }

  function showPaymentModal(appt) {
    const body = $("modal-payment-body");
    body.innerHTML = `
      <p><strong>Paciente:</strong> ${appt.patientName}</p>
      <p><strong>Valor:</strong> ${formatMoney(appt.value)} • <strong>Status:</strong> ${appt.statusLabel}</p>
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
          appt.invoiceUrl
            ? `<a href="${appt.invoiceUrl}" target="_blank" rel="noopener" class="btn btn-primary">🔗 Abrir Fatura Asaas</a>`
            : ""
        }
        <a href="${buildWhatsAppUrl(appt)}" target="_blank" rel="noopener" class="btn btn-outline">📲 Enviar no WhatsApp</a>
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

  // --- Fluxo de Verificação de Plano e Agendamento ---

  async function runPlanVerification() {
    const cpf = $("appt-cpf").value;
    const box = $("plan-check-result");
    box.classList.remove("hidden", "check-ok", "check-error");
    box.textContent = "⏳ Consultando situação do paciente no Asaas...";

    const result = await apiVerificarPlano(cpf);
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
            result.linkRegularizacao
              ? `<a href="${result.linkRegularizacao}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">🔗 Ver Fatura Vencida</a>`
              : ""
          }
          <button type="button" id="btn-switch-particular" class="btn btn-primary btn-sm">💳 Mudar para Particular</button>
          <button type="button" id="btn-log-refusal" class="btn btn-danger-outline btn-sm">🚫 Registrar Recusa na Agenda</button>
        </div>
      `;

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
      type,
      status,
      statusLabel:
        status === "CONFIRMED"
          ? type === "PLANO"
            ? "Plano em Dia"
            : "Pago"
          : status === "PENDING"
          ? `Aguardando ${extra.billingType || "Pagamento"}`
          : "Recusada (Plano)",
      value: type === "PARTICULAR" ? Number($("appt-value").value || 0) : 0,
      billingType: extra.billingType || null,
      paymentId: extra.paymentId || null,
      invoiceUrl: invoiceUrl || extra.invoiceUrl || null,
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
      type === "PLANO" ? "Verificar Plano e Confirmar" : "Gerar Cobrança Asaas e Agendar";
  }

  // --- Inicialização e Eventos ---

  function initSelects() {
    const profSelect = $("appt-professional");
    const filterProf = $("filter-professional");
    CFG.profissionais.forEach((p) => {
      const opt = new Option(`${p.nome} — ${p.especialidade} (${formatMoney(p.valorParticular)})`, p.id);
      profSelect.add(opt);
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
      planSelect.add(new Option(`${pl.nome} — ${formatMoney(pl.valor)}/mês`, pl.id));
    });
  }

  function initEvents() {
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

    // Filtros
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

    // Fechar modais
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

    // Botões de dica CPF Demo
    document.querySelectorAll(".hint-btn").forEach((btn) => {
      btn.onclick = () => {
        $("appt-cpf").value = btn.dataset.cpf;
        const clean = sanitizeDoc(btn.dataset.cpf);
        const cli = CFG.demoClientesAsaas[clean];
        if (cli) {
          $("appt-name").value = cli.name;
          $("appt-phone").value = cli.phone;
        }
        runPlanVerification();
      };
    });

    $("appt-cpf").addEventListener("input", (e) => {
      e.target.value = formatCpf(e.target.value);
      lastPlanCheck = null;
    });

    document.querySelectorAll('input[name="appt-type"]').forEach((r) => {
      r.addEventListener("change", toggleTypePanels);
    });

    $("btn-verify-plan").onclick = runPlanVerification;

    // Submit Consulta
    $("form-appointment").onsubmit = async (e) => {
      e.preventDefault();
      const type = document.querySelector('input[name="appt-type"]:checked').value;

      if (type === "PLANO") {
        const check = lastPlanCheck || (await runPlanVerification());
        if (!check.autorizado) {
          return; // Bloqueia confirmação automática quando inadimplente ou sem plano
        }
        saveNewAppointment("CONFIRMED");
        return;
      }

      // Particular -> Gera cobrança no Asaas
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
          description: `Consulta ${prof ? prof.nome : ""} - ${formatDateBr($("appt-date").value)}`,
        });

        if (!resp.ok) {
          alert(`Erro Asaas: ${resp.error || "Não foi possível gerar a cobrança."}`);
          return;
        }

        const saved = saveNewAppointment("PENDING", null, resp.payment.invoiceUrl, {
          billingType,
          paymentId: resp.payment.id,
          invoiceUrl: resp.payment.invoiceUrl,
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
        if (confirm(`Remover consulta de ${appt.patientName}?`)) {
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
          if (st === "RECEIVED" || st === "CONFIRMED") {
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

    // Nova Assinatura
    $("btn-new-subscription").onclick = () => {
      $("form-subscription").reset();
      $("sub-result").classList.add("hidden");
      openModal("modal-subscription");
    };

    $("sub-cpf").addEventListener("input", (e) => {
      e.target.value = formatCpf(e.target.value);
    });

    $("form-subscription").onsubmit = async (e) => {
      e.preventDefault();
      const plan = CFG.planos.find((p) => p.id === $("sub-plan").value);
      const box = $("sub-result");
      box.classList.remove("hidden", "check-ok", "check-error");
      box.textContent = "⏳ Criando assinatura no Asaas...";

      const res = await apiCriarAssinatura({
        name: $("sub-name").value.trim(),
        cpfCnpj: $("sub-cpf").value,
        phone: $("sub-phone").value,
        value: plan.valor,
        cycle: plan.ciclo,
        billingType: $("sub-billing").value,
        description: plan.nome,
      });

      if (res.ok) {
        box.classList.add("check-ok");
        const link = res.firstPayment?.invoiceUrl;
        box.innerHTML = `✅ Assinatura <strong>${plan.nome}</strong> criada! ${
          link ? `<br><a href="${link}" target="_blank" rel="noopener">🔗 Abrir link da 1ª mensalidade</a>` : ""
        }`;
      } else {
        box.classList.add("check-error");
        box.textContent = `❌ ${res.error || "Erro ao criar assinatura."}`;
      }
    };

    // Área da Recepção / Admin
    $("btn-open-admin").onclick = () => openModal("modal-admin");
    $("btn-admin-login").onclick = () => {
      if ($("admin-pin-input").value === CFG.pinRecepcao) {
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
      const blob = new Blob([JSON.stringify(appointments, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `agenda-clinica-${getTodayIso()}.json`;
      a.click();
    };

    $("btn-reset-demo").onclick = () => {
      if (confirm("Restaurar os agendamentos de exemplo?")) {
        appointments = seedDemoAppointments();
        saveAppointments();
        renderAgenda();
      }
    };
  }

  $("clinic-name").textContent = CFG.nomeClinica;
  $("clinic-subtitle").textContent = CFG.subtitulo;
  updateModeUI();
  initSelects();
  loadAppointments();
  renderAgenda();
  initEvents();
})();
