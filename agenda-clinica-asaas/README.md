# Agenda da Clínica + Integração Asaas

Sistema simples e acessível de **Agenda de Consultas para Clínica** (HTML/CSS/JS + Netlify Functions), inspirado na leveza do projeto anterior, com integração completa à instituição financeira **Asaas**.

---

## O que o sistema faz
1. **Verificação automática de Plano (Assinatura Asaas)**:
   - Ao agendar como **Plano da Clínica**, consulta o CPF do paciente no Asaas.
   - Se o plano estiver **ativo e sem faturas vencidas**, libera e confirma o agendamento.
   - Se houver **fatura vencida (`OVERDUE`)** ou **nenhuma assinatura ativa**, **recusa o agendamento**, informa o motivo exato, exibe o link da fatura para regularização e permite enviar no WhatsApp ou mudar para **Particular**.
2. **Cobrança Avulsa (Particular)**:
   - Gera cobrança no Asaas via **Pix** (com QR Code e Copia e Cola), **Boleto**, **Cartão de Crédito** ou **Link de Pagamento**.
   - Botão **📲 WhatsApp** envia a confirmação ou o link de pagamento pronto para o paciente.
3. **Adesão a Planos (Assinaturas Recorrentes)**:
   - Botão **🌟 Novo Plano** cria uma assinatura mensal recorrente diretamente no Asaas.
4. **Confirmação Automática via Webhook + Sincronização**:
   - Endpoint `/.netlify/functions/asaas-webhook` pronto para receber `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED` e `PAYMENT_OVERDUE`.
   - Botão **🔄 Atualizar Asaas** em cada consulta pendente para consultar o status em tempo real.

---

## Como testar agora no computador (Modo Demonstração)
1. Abra a pasta `agenda-clinica-asaas`.
2. Dê dois cliques em `index.html` para abrir no navegador.
3. Clique em **+ Nova Consulta** e use os botões de teste rápido no topo do formulário:
   - `111.111.111-11` → Paciente com **Plano em Dia** (aprova).
   - `222.222.222-22` → Paciente **Inadimplente** (recusa e mostra fatura vencida).
   - `333.333.333-33` → Paciente **Sem Plano** (recusa pelo plano e permite cobrar como Particular).

---

## Como ativar com o Asaas Real no Netlify (Seguro)
A chave da API do Asaas **nunca** fica no navegador; ela roda protegida nas **Netlify Functions** (`netlify/functions/`).

1. Crie uma conta no **Asaas Sandbox** (`https://sandbox.asaas.com`) para testes (ou use sua conta de produção).
2. No painel do Asaas, vá em **Integrações > Chaves de API** e gere sua chave (`$aact_...`).
3. Suba a pasta `agenda-clinica-asaas` para o **Netlify** (conectando via GitHub ou Netlify CLI, pois Netlify Drop simples não instala dependências das Functions).
4. No painel do Netlify, vá em **Site configuration > Environment variables** e adicione:
   - `ASAAS_ENV` = `sandbox` (ou `production` quando for para valer)
   - `ASAAS_API_KEY` = sua chave do Asaas
   - `ASAAS_WEBHOOK_TOKEN` = uma senha secreta criada por você
5. No painel do Asaas, vá em **Integrações > Webhooks**, crie um novo webhook apontando para:
   - URL: `https://SEU-SITE.netlify.app/.netlify/functions/asaas-webhook`
   - Token de autenticação: o mesmo valor de `ASAAS_WEBHOOK_TOKEN`
   - Eventos: `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `SUBSCRIPTION_INACTIVATED`.

---

## Como personalizar médicos, planos e senha
Abra o arquivo `data.js` e edite:
- `nomeClinica` e `pinRecepcao` (padrão: `2027`).
- `profissionais` (nomes, especialidades e valores particulares).
- `planos` (nomes e mensalidades).
