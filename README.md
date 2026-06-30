# Banco de Horas PIBN — app online

Registro de horas dos funcionários por dia/evento, com cálculo automático de total de horas e
total a pagar. Dados **compartilhados** (Vercel + Vercel KV). Importa a planilha de 2026.

Funciona pelo navegador e dá pra instalar na tela inicial do iPhone. Tudo pelo site, sem terminal.

## Conteúdo importado
- 4 funcionários (Nathan, Maycon, Daniel — R$35/h; Arthur — R$40/h)
- 7 meses (Junho a Dezembro 2026) com a agenda diária/eventos. Junho já vem com horas lançadas.

## Deploy (mesmo passo a passo do app de gravações)

### 1. GitHub
1. https://github.com/new → nome `banco-horas-app` (ou outro) → Create
2. Add file → Upload files → arraste TODOS os arquivos desta pasta, incluindo:
   - `index.html`, `api/data.js` (dentro da pasta `api`), `package.json`,
     `manifest.webmanifest`, `dados-iniciais.json`, os 3 `.png`, `README.md`
3. Commit changes

### 2. Vercel
1. https://vercel.com/new → Import o repositório → Framework **Other** → Deploy

### 3. Banco (Vercel KV / Upstash Redis)
1. Projeto → aba **Storage** → Create Database → **Upstash for Redis** → Create
2. **Connect** ao projeto (todos os ambientes)

### 4. Código de acesso (recomendado)
1. Settings → Environment Variables → `ACCESS_CODE` = uma senha → Save

### 5. Republicar
1. Deployments → ⋯ → Redeploy

Na primeira abertura, o app carrega os dados da planilha (`dados-iniciais.json`) e os grava no banco.

## Usar no iPhone
Safari → abrir o link → digitar o código → Compartilhar → Adicionar à Tela de Início.

## Como funciona
- **Registro:** escolha o mês, veja/edite os dias. Em cada dia, lance entrada/saída por funcionário
  (as horas são calculadas sozinhas) ou ajuste as horas manualmente.
- **Pagamento:** total de horas e total a pagar por funcionário, no mês e no ano.
- **Funcionários:** cadastro e valor/hora.
- Sincroniza a cada ~8s entre dispositivos. Botão no topo mostra o status.
