# API de Agendamento

API REST pequena, funcional e sem dependência de banco externo para criar, listar e cancelar agendamentos. A aplicação é escrita em **Node.js + TypeScript** e usa apenas o módulo nativo `node:http` em tempo de execução.

## Decisões e regras de negócio

- **Armazenamento:** memória do processo (`Map`), sem SQLite ou serviço externo. É simples para desenvolvimento e demonstração; os dados são perdidos ao reiniciar o processo e não há replicação entre instâncias.
- **Calendário único:** como a API não recebe um recurso/profissional, qualquer sobreposição entre agendamentos ativos é conflito.
- **Sobreposição:** intervalos são semiabertos (`[início, fim)`). Um agendamento que começa exatamente quando outro termina é permitido; qualquer outra interseção retorna `409`.
- **Cancelamento:** por padrão, só é permitido cancelar com pelo menos **24 horas de antecedência** (`CANCELLATION_WINDOW_HOURS`). Agendamentos já iniciados ou dentro da janela retornam `422`. O valor pode ser alterado para testes ou operação por variável de ambiente.
- **Datas:** devem ser ISO 8601 com timezone explícito (`Z` ou `+/-HH:MM`) e são normalizadas para UTC no retorno.
- **Validação:** nome obrigatório (1–120 caracteres), e-mail válido (até 254), início no futuro, fim posterior ao início e notas opcionais (até 500 caracteres).

A especificação estática está em [`openapi.yaml`](./openapi.yaml) e também é servida por `GET /openapi.yaml`.

## Requisitos

- Node.js 20 ou superior
- npm 10 ou superior

## Executar localmente

```bash
cp .env.example .env
npm install
npm run dev
```

Para uma execução compilada:

```bash
npm run build
npm start
```

Por padrão, a API escuta em `http://0.0.0.0:3000`. `HOST`, `PORT` e `CANCELLATION_WINDOW_HOURS` podem ser definidos no ambiente. O projeto não carrega `.env` automaticamente para manter as dependências mínimas; exporte as variáveis no shell ou use um carregador externo quando necessário.

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Verifica disponibilidade da API |
| `POST` | `/appointments` | Cria agendamento e rejeita conflito |
| `GET` | `/appointments` | Lista agendamentos; filtros opcionais `status`, `from` e `to` |
| `GET` | `/appointments/:id` | Consulta um agendamento |
| `DELETE` | `/appointments/:id` | Cancela um agendamento respeitando a janela |
| `POST` | `/appointments/:id/cancel` | Alias explícito para cancelamento |
| `GET` | `/openapi.yaml` | Obtém a especificação OpenAPI estática |

Exemplo de criação:

```bash
curl -X POST http://localhost:3000/appointments \\
  -H 'content-type: application/json' \\
  -d '{
    "customerName": "Maria Silva",
    "customerEmail": "maria@example.com",
    "startAt": "2030-06-10T14:00:00-03:00",
    "endAt": "2030-06-10T15:00:00-03:00",
    "notes": "Primeira consulta"
  }'
```

A resposta é `201 Created` e contém um `id` UUID, o status `scheduled` e as datas normalizadas para UTC.

Listagem:

```bash
curl 'http://localhost:3000/appointments?status=scheduled'
```

Cancelamento:

```bash
curl -X DELETE http://localhost:3000/appointments/ID_DO_AGENDAMENTO
```

## Erros

Todos os erros têm o formato `{ "error": { "code": "...", "message": "...", "details": ... } }`.

- `400`: JSON inválido, rota/método inválido ou filtro/data inválidos
- `404`: agendamento inexistente
- `409`: intervalo em conflito ou agendamento já cancelado
- `422`: regra de validação ou janela de cancelamento violada

## Testes e CI

```bash
npm test       # testes de integração HTTP com node:test + tsx
npm run check  # build TypeScript e testes
```

O workflow [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) executa `npm ci` e `npm run check` em pushes e pull requests.

## Segurança e produção

Este armazenamento em memória não foi projetado para produção: não oferece persistência, autenticação, rate limiting ou coordenação entre réplicas. Para produção, substitua o repositório por SQLite/PostgreSQL e acrescente autenticação, logs estruturados e controles de acesso.
