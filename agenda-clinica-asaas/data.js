/**
 * Configurações iniciais da Clínica e dados de exemplo.
 * Altere o nome da clínica, profissionais, valores e o PIN da recepção aqui.
 */
window.CLINICA_CONFIG = {
  nomeClinica: "Clínica Vida & Saúde",
  subtitulo: "Agenda de Consultas • Integração Asaas",
  pinRecepcao: "2027",
  // "demo" funciona direto ao abrir o index.html; "netlify" usa /.netlify/functions/* com sua chave real do Asaas
  modoIntegracao: "auto", // "auto" detecta se está rodando no Netlify ou localmente via file://
  profissionais: [
    { id: "dr-carlos", nome: "Dr. Carlos Mendes", especialidade: "Clínico Geral", valorParticular: 220.0 },
    { id: "dra-ana", nome: "Dra. Ana Paula", especialidade: "Cardiologia", valorParticular: 350.0 },
    { id: "dra-juliana", nome: "Dra. Juliana Costa", especialidade: "Pediatria", valorParticular: 260.0 },
    { id: "dr-rafael", nome: "Dr. Rafael Lima", especialidade: "Ortopedia", valorParticular: 300.0 },
  ],
  planos: [
    { id: "plano-essencial", nome: "Plano Essencial Mensal", valor: 149.0, ciclo: "MONTHLY" },
    { id: "plano-familia", nome: "Plano Família Total", valor: 289.0, ciclo: "MONTHLY" },
  ],
  // CPFs fictícios pré-cadastrados para testar o Modo Demonstração instantaneamente
  demoClientesAsaas: {
    "11111111111": {
      id: "cus_demo_001",
      name: "Maria Aparecida Silva",
      cpfCnpj: "11111111111",
      phone: "11999991111",
      situacao: "EM_DIA",
      plano: {
        id: "sub_demo_001",
        description: "Plano Essencial Mensal",
        value: 149.0,
        cycle: "MONTHLY",
        nextDueDate: "2026-12-10",
        status: "ACTIVE",
      },
      faturasVencidas: [],
    },
    "22222222222": {
      id: "cus_demo_002",
      name: "João Pedro Oliveira",
      cpfCnpj: "22222222222",
      phone: "11999992222",
      situacao: "INADIMPLENTE",
      plano: {
        id: "sub_demo_002",
        description: "Plano Família Total",
        value: 289.0,
        cycle: "MONTHLY",
        nextDueDate: "2026-10-15",
        status: "ACTIVE",
      },
      faturasVencidas: [
        {
          id: "pay_demo_venc_01",
          value: 289.0,
          dueDate: "2026-10-15",
          billingType: "BOLETO",
          invoiceUrl: "https://sandbox.asaas.com/i/demo-fatura-vencida-01",
        },
      ],
    },
    "33333333333": {
      id: "cus_demo_003",
      name: "Fernanda Souza",
      cpfCnpj: "33333333333",
      phone: "11999993333",
      situacao: "SEM_PLANO_ATIVO",
      plano: null,
      faturasVencidas: [],
    },
  },
};
