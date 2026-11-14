/**
 * Helper compartilhado para chamadas autenticadas à API v3 do Asaas, validação de CPF e regras de carência/quarentena.
 */

const ASAAS_URLS = {
  sandbox: "https://api-sandbox.asaas.com/v3",
  production: "https://api.asaas.com/v3",
};

export const ASAAS_BILLING_RULES = {
  discount: {
    value: 5,
    dueDateLimitDays: 0,
    type: "PERCENTAGE",
  },
  fine: {
    value: 2,
    type: "PERCENTAGE",
  },
  interest: {
    value: 2,
  },
};

export const DEFAULT_CARENCIAS = {
  examesLaboratoriaisDias: 40,
  eletroPreventivoDias: 30,
  raioXDias: 30,
  consulta1a2VidasDias: 30,
  consulta3MaisVidasDias: 0,
  quarentenaSaidaMeses: 6,
};

export function sanitizeCpfCnpj(value) {
  return String(value || "").replace(/\D/g, "");
}

/**
 * Validador oficial de CPF (11 dígitos e cálculo dos 2 dígitos verificadores).
 */
export function isValidCpf(value) {
  const cpf = sanitizeCpfCnpj(value);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(cpf[i]) * (10 - i);
  }
  let rev = 11 - (sum % 11);
  if (rev === 10 || rev === 11) rev = 0;
  if (rev !== Number(cpf[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += Number(cpf[i]) * (11 - i);
  }
  rev = 11 - (sum % 11);
  if (rev === 10 || rev === 11) rev = 0;
  return rev === Number(cpf[10]);
}

export function generateMatricula(existingCount = 0) {
  const year = new Date(Date.now() - 3 * 60 * 60 * 1000).getUTCFullYear();
  const seq = String(existingCount + 1).padStart(4, "0");
  const rand = Math.floor(10 + Math.random() * 90);
  return `MAT-${year}-${seq}${rand}`;
}

export function getTodayBrazilIso() {
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

export function formatDateBr(isoDate) {
  if (!isoDate) return "-";
  const [y, m, d] = String(isoDate).split("-");
  return d && m && y ? `${d}/${m}/${y}` : isoDate;
}

export function addDaysIso(isoDate, days) {
  const dt = new Date(`${isoDate}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
  return dt.toISOString().slice(0, 10);
}

export function addMonthsIso(isoDate, months) {
  const dt = new Date(`${isoDate}T12:00:00Z`);
  dt.setUTCMonth(dt.getUTCMonth() + Number(months || 0));
  return dt.toISOString().slice(0, 10);
}

export function addYearsIso(isoDate, years) {
  const dt = new Date(`${isoDate}T12:00:00Z`);
  dt.setUTCFullYear(dt.getUTCFullYear() + Number(years || 0));
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(startIso, endIso) {
  if (!startIso || !endIso) return 0;
  const s = new Date(`${startIso}T00:00:00Z`).getTime();
  const e = new Date(`${endIso}T00:00:00Z`).getTime();
  return Math.floor((e - s) / 86400000);
}

export function checkQuarantineBlock(historicoSaidas, cpf, today = getTodayBrazilIso()) {
  const clean = sanitizeCpfCnpj(cpf);
  if (!clean || !Array.isArray(historicoSaidas)) return null;
  return (
    historicoSaidas.find(
      (item) => sanitizeCpfCnpj(item.cpf) === clean && item.bloqueadoAte && item.bloqueadoAte >= today
    ) || null
  );
}

export function evaluateCarencia({
  procedimento = "CONSULTA",
  dataAdesao,
  totalVidas = 1,
  regras = DEFAULT_CARENCIAS,
  today = getTodayBrazilIso(),
}) {
  const r = { ...DEFAULT_CARENCIAS, ...(regras || {}) };
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

export function getAsaasBaseUrl() {
  const env = (process.env.ASAAS_ENV || "sandbox").toLowerCase();
  return ASAAS_URLS[env] || ASAAS_URLS.sandbox;
}

export function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    },
    body: JSON.stringify(data),
  };
}

export async function asaasFetch(path, options = {}) {
  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) {
    const err = new Error("ASAAS_API_KEY não configurada nas variáveis de ambiente do Netlify.");
    err.statusCode = 500;
    throw err;
  }

  const url = `${getAsaasBaseUrl()}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "AgendaClinicaAsaas/1.0",
      access_token: apiKey,
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const firstError = payload?.errors?.[0]?.description || payload?.message || `Erro HTTP ${response.status}`;
    const err = new Error(firstError);
    err.statusCode = response.status;
    err.details = payload;
    throw err;
  }

  return payload;
}

export async function findOrCreateCustomer({ name, cpfCnpj, phone, email, endereco, externalReference }) {
  const cleanDoc = sanitizeCpfCnpj(cpfCnpj);
  if (!cleanDoc) {
    const err = new Error("CPF/CNPJ é obrigatório.");
    err.statusCode = 400;
    throw err;
  }

  const customerBody = {
    name,
    cpfCnpj: cleanDoc,
    mobilePhone: sanitizeCpfCnpj(phone) || undefined,
    email: email || undefined,
    postalCode: sanitizeCpfCnpj(endereco?.cep) || undefined,
    address: endereco?.logradouro || undefined,
    addressNumber: endereco?.numero || undefined,
    complement: endereco?.complemento || undefined,
    province: endereco?.bairro || undefined,
    externalReference: externalReference || undefined,
    notificationDisabled: false,
  };

  const search = await asaasFetch(`/customers?cpfCnpj=${encodeURIComponent(cleanDoc)}`);
  if (search.data && search.data.length > 0) {
    const existing = search.data[0];
    if (endereco?.cep) {
      try {
        return await asaasFetch(`/customers/${existing.id}`, {
          method: "PUT",
          body: JSON.stringify(customerBody),
        });
      } catch {
        return existing;
      }
    }
    return existing;
  }

  if (!name) {
    const err = new Error("Nome do paciente é obrigatório para novo cadastro no Asaas.");
    err.statusCode = 400;
    throw err;
  }

  return asaasFetch("/customers", {
    method: "POST",
    body: JSON.stringify(customerBody),
  });
}
