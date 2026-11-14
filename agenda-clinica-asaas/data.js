/**
 * Configurações da Clínica, Tabela Oficial de Planos, Carências e Regras Financeiras Asaas.
 */
window.CLINICA_CONFIG = {
  nomeClinica: "Clínica Vida & Saúde",
  subtitulo: "Agenda de Consultas • Gestão de Planos, Carências & Asaas",
  pinRecepcao: "2027",
  pinMaster: "9999", // Senha Master do responsável pelo setor (libera carências e quarentena de 6 meses)
  modoIntegracao: "auto",

  // Regras financeiras dos planos e boletos no Asaas
  regrasFinanceiras: {
    taxaAdesaoFixa: 10.0, // R$ 10,00 na 1ª mensalidade ou ao incluir novos dependentes depois
    valorDependentePosterior: 60.0, // +R$ 60,00/mês por dependente incluído após a criação do plano
    descontoPontualidadePct: 5, // 5% de desconto para pagamento até a data de vencimento
    multaAtrasoPct: 2, // 2% de multa após o vencimento
    jurosMensalPct: 2, // 2% de juros ao mês após o vencimento
    reajusteAnualPct: 5, // +5% de reajuste anual automático a cada 1 ano de contrato
  },

  // Regras padrão de carência (editáveis pelo Acesso Master tanto globalmente quanto por contrato)
  regrasCarenciaPadrao: {
    examesLaboratoriaisDias: 40, // 40 dias para exames laboratoriais
    eletroPreventivoDias: 30, // 30 dias para eletrocardiograma e preventivo
    raioXDias: 30, // 30 dias para raio-X
    consulta1a2VidasDias: 30, // 30 dias para consultas em planos de 1 ou 2 vidas
    consulta3MaisVidasDias: 0, // Zero carência para consultas a partir de 3 vidas
    quarentenaSaidaMeses: 6, // 6 meses (180 dias) bloqueado após sair ou cancelar o plano
  },

  procedimentos: [
    { id: "CONSULTA", nome: "🩺 Consulta Médica (1-2 vidas: 30d | 3+ vidas: Zero carência)" },
    { id: "EXAME_LAB", nome: "🧪 Exames Laboratoriais (Carência padrão: 40 dias)" },
    { id: "ELETRO_PREV", nome: "❤️ Eletrocardiograma / Preventivo (Carência padrão: 30 dias)" },
    { id: "RAIO_X", nome: "🩻 Raio-X (Carência padrão: 30 dias)" },
  ],

  profissionais: [
    { id: "dr-carlos", nome: "Dr. Carlos Mendes", especialidade: "Clínico Geral", valorParticular: 220.0 },
    { id: "dra-ana", nome: "Dra. Ana Paula", especialidade: "Cardiologia", valorParticular: 350.0 },
    { id: "dra-juliana", nome: "Dra. Juliana Costa", especialidade: "Pediatria", valorParticular: 260.0 },
    { id: "dr-rafael", nome: "Dr. Rafael Lima", especialidade: "Ortopedia", valorParticular: 300.0 },
  ],

  // Tabela oficial de planos (2 pessoas atualizado para R$ 170,00)
  planos: [
    { id: "plano-1", nome: "Plano Individual (1 pessoa - só Titular)", pessoas: 1, maxDependentes: 0, valor: 120.0, ciclo: "MONTHLY", categoria: "TABELA" },
    { id: "plano-2", nome: "Plano 2 Pessoas (Titular + 1 dependente)", pessoas: 2, maxDependentes: 1, valor: 170.0, ciclo: "MONTHLY", categoria: "TABELA" },
    { id: "plano-3", nome: "Plano 3 Pessoas (Titular + 2 dependentes)", pessoas: 3, maxDependentes: 2, valor: 220.0, ciclo: "MONTHLY", categoria: "TABELA" },
    { id: "plano-4", nome: "Plano 4 Pessoas (Titular + 3 dependentes)", pessoas: 4, maxDependentes: 3, valor: 270.0, ciclo: "MONTHLY", categoria: "TABELA" },
    { id: "plano-5", nome: "Plano 5 Pessoas (Titular + 4 dependentes)", pessoas: 5, maxDependentes: 4, valor: 320.0, ciclo: "MONTHLY", categoria: "TABELA" },
    { id: "plano-6", nome: "Plano 6 Pessoas (Titular + 5 dependentes)", pessoas: 6, maxDependentes: 5, valor: 370.0, ciclo: "MONTHLY", categoria: "TABELA" },
    { id: "plano-7", nome: "Plano 7 Pessoas (Titular + 6 dependentes)", pessoas: 7, maxDependentes: 6, valor: 420.0, ciclo: "MONTHLY", categoria: "TABELA" },
    { id: "plano-8", nome: "Plano 8 Pessoas (Titular + 7 dependentes)", pessoas: 8, maxDependentes: 7, valor: 470.0, ciclo: "MONTHLY", categoria: "TABELA" },
    { id: "plano-9", nome: "Plano 9 Pessoas (Titular + 8 dependentes)", pessoas: 9, maxDependentes: 8, valor: 520.0, ciclo: "MONTHLY", categoria: "TABELA" },
    { id: "plano-10", nome: "Plano 10 Pessoas (Titular + 9 dependentes)", pessoas: 10, maxDependentes: 9, valor: 570.0, ciclo: "MONTHLY", categoria: "TABELA" },
    // Planos especiais para acima de 10 dependentes (valor em aberto / definido na contratação)
    { id: "plano-bronze", nome: "Plano Bronze (Acima de 10 dependentes)", pessoas: 11, maxDependentes: 99, valor: null, ciclo: "MONTHLY", categoria: "BRONZE" },
    { id: "plano-prata", nome: "Plano Prata (Acima de 10 dependentes)", pessoas: 11, maxDependentes: 99, valor: null, ciclo: "MONTHLY", categoria: "PRATA" },
    { id: "plano-ouro", nome: "Plano Ouro (Acima de 10 dependentes)", pessoas: 11, maxDependentes: 99, valor: null, ciclo: "MONTHLY", categoria: "OURO" },
  ],

  demoClientesAsaas: {
    "11111111111": {
      id: "cus_demo_001",
      name: "Maria Aparecida Silva",
      cpfCnpj: "11111111111",
      phone: "11999991111",
      situacao: "EM_DIA",
      plano: {
        id: "sub_demo_001",
        description: "Plano 2 Pessoas (Titular + 1 dependente)",
        value: 170.0,
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
        description: "Plano 4 Pessoas (Titular + 3 dependentes)",
        value: 270.0,
        cycle: "MONTHLY",
        nextDueDate: "2026-10-15",
        status: "ACTIVE",
      },
      faturasVencidas: [
        {
          id: "pay_demo_venc_01",
          value: 270.0,
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
