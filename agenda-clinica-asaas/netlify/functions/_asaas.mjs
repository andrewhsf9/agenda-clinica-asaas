/**
 * Helper compartilhado para chamadas autenticadas à API v3 do Asaas.
 * A chave ASAAS_API_KEY fica protegida nas variáveis de ambiente do Netlify.
 */

const ASAAS_URLS = {
  sandbox: "https://api-sandbox.asaas.com/v3",
  production: "https://api.asaas.com/v3",
};

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
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

export function sanitizeCpfCnpj(value) {
  return String(value || "").replace(/\D/g, "");
}

/**
 * Busca cliente existente por CPF/CNPJ ou cria um novo no Asaas.
 */
export async function findOrCreateCustomer({ name, cpfCnpj, phone, email }) {
  const cleanDoc = sanitizeCpfCnpj(cpfCnpj);
  if (!cleanDoc) {
    const err = new Error("CPF/CNPJ é obrigatório.");
    err.statusCode = 400;
    throw err;
  }

  const search = await asaasFetch(`/customers?cpfCnpj=${encodeURIComponent(cleanDoc)}`);
  if (search.data && search.data.length > 0) {
    return search.data[0];
  }

  if (!name) {
    const err = new Error("Nome do paciente é obrigatório para novo cadastro no Asaas.");
    err.statusCode = 400;
    throw err;
  }

  return asaasFetch("/customers", {
    method: "POST",
    body: JSON.stringify({
      name,
      cpfCnpj: cleanDoc,
      mobilePhone: sanitizeCpfCnpj(phone) || undefined,
      email: email || undefined,
      notificationDisabled: false,
    }),
  });
}
