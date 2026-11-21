# Métricas de movimento (hora e dia)

Métricas de fluxo de acessos, no fuso local da academia.

## 1. Dashboard (Início)

- **Últimos 7 dias:** alunos distintos por dia (frequência).
- **Movimento por horário:** acessos de **hoje** em cada hora (00–23), com
  liberados/negados e pessoas distintas.
- **Movimento por dia da semana:** últimos 7 dias agregados por domingo…sábado.
- **Presentes agora**, últimas entradas e KPIs do dia.

Fonte: `GET /api/overview` com os campos:

```json
{
  "semana": [{ "dia": "2026-11-21", "total": 10, "liberados": 6, "alunos": 2 }],
  "movimentoHora": [{ "hora": 17, "total": 10, "liberados": 6, "negados": 4 }],
  "porDiaSemana": [{ "dia": 6, "total": 10, "liberados": 6, "alunos": 2 }]
}
```

## 2. Relatórios por período

Em **Relatórios** (`/api/relatorios/geral`):

- **Por dia:** data, total, liberados, negados e pessoas distintas.
- **Por horário:** 24 linhas, com total/liberados/negados/pessoas.
- **Por dia da semana:** agregado domingo…sábado no período.
- Exportação CSV/PDF inclui as duas visões.

## 3. Definições

- **Acesso:** todo evento de identificação (ALLOW ou DENY), incluindo tentativas
  negadas.
- **Pessoas distintas:** `personId` único no recorte (dia/hora/semana).
- **Dia:** chave local `AAAA-MM-DD`; não usa UTC para não virar o dia à noite.
- **Horário:** hora local do evento (0–23).
- **Dia da semana:** 0 domingo … 6 sábado.

## 4. Observações

- Não há limite de entradas por dia; o gráfico mostra volume, não bloqueio.
- Eventos de liberação manual entram como `MANUAL`.
- Para períodos longos, o relatório por dia pode ter muitas linhas; use CSV.
- Dados de eventos antigos respeitam a retenção LGPD configurada.
