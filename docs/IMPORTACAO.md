# Importação de cadastros

Importa pessoas de outro sistema por **CSV ou JSON**, sem exigir biometria.
Fotos são opcionais; regras, sincronização com o leitor e senha inicial são
criadas como no cadastro normal.

## 1. Formatos

CSV (separador `;` ou `,`, com cabeçalho):

```csv
nome;matricula;tipo;enrollid;validadeFim;treinutrix;ativo
Ana Silva;A1001;ALUNO;1001;2027-12-31;@ana;sim
João Souza;V2001;VISITANTE;;2026-11-30;;sim
```

JSON:

```json
{
  "arquivo": "sistema-antigo.json",
  "modo": "ATUALIZAR",
  "pessoas": [
    { "nome": "Ana", "matricula": "A1001", "tipo": "ALUNO", "enrollid": 1001 }
  ]
}
```

Campos: `nome` (obrigatório), `matricula`, `tipo` (`ALUNO`/`PERSONAL`/
`VISITANTE`), `enrollid`, `validadeIni`, `validadeFim`, `treinutrix`, `ativo`,
`senha`, `foto` (data URL/base64) e opcionais `cpf`, `telefone`, `email`,
`nascimento`, `endereco`, `bairro`, `cidade`, `cep`, `observacoes`, `objetivo`,
`peso`, `problemasSaude`, `necessidadesEspeciais`.

## 2. Mapeamento de colunas

No painel, ao escolher o CSV, cada coluna ganha um seletor de destino. O
mapeamento automático reconhece nomes comuns e acentos (`Nome`, `Matrícula`,
`Cartão`, `Vencimento`…). Ajuste e clique em **Aplicar mapeamento**.

Via API, envie `mapeamento` (destino → coluna de origem):

```json
{ "nome": "Nome Completo", "matricula": "CPF", "validadeFim": "Vencimento" }
```

## 3. Modos e atomicidade

- `modo: "IGNORAR"` (padrão): cadastro existente é ignorado.
- `modo: "ATUALIZAR"`: faz **upsert** de nome, tipo, treinutrix, validades,
  ativo, senha e foto (matrícula/enrollid não mudam).
- `confirmar: false`: prévia, não grava.
- `atomic: true` (padrão): se qualquer linha tiver erro, **nada é gravado** e a
  API responde `409` com o relatório.
- `ignorarErros: true`: grava só as linhas válidas (a UI pergunta antes).
- Duplicados na mesma importação são recusados.
- Erros inesperados no meio da gravação revertem pessoas, regras, fila e meta.

## 4. Fotos

- Coluna/campo `foto` com data URL (`data:image/jpeg;base64,...`) ou base64.
- No painel, selecione várias imagens; o nome do arquivo é ligado à matrícula,
  ao cartão ou ao nome (sem extensão). Ex.: `A1001.jpg`.
- Aplicamos a mesma validação do upload normal (JPEG/PNG/WebP e
  `PHOTO_MAX_BYTES`).
- LGPD: colete consentimento e defina retenção; a importação não cria biometria
  sem foto.

## 5. Limites

- `IMPORT_MAX_ROWS` (padrão 20000), `IMPORT_MAX_BYTES` (padrão 10 MB).
- Para bases maiores, divida em arquivos por ano/faixa de matrícula.
- XLSX não é aceito sem dependência: exporte para CSV no sistema de origem.

## 6. Histórico e relatório

- Toda importação confirmada gera um registro (últimos 100):
  `GET /api/imports`, `GET /api/imports/:id`.
- Relatório das linhas: `GET /api/imports/:id/relatorio.csv`.
- A prévia não entra no histórico.
- O registro guarda somente resumo e até 500 linhas de resultado (sem a base
  completa), reduzindo exposição de dados.

## 7. API

```bash
curl -X POST http://localhost:3001/api/persons/import \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"confirmar":false,"modo":"ATUALIZAR","pessoas":[{"nome":"Ana","matricula":"A1"}]}'
```

Resposta (resumo): `confirmado`, `modo`, `total`, `novos`, `atualizaveis`,
`criados`, `atualizados`, `ignorados`, `erros`, `itens`.

## 8. Diagnóstico

| Sintoma | Causa/ação |
|---------|------------|
| `409 importação com erros` | prévia mostra as linhas; corrija ou use “importar válidos” |
| `matrícula já existe` | use `modo: ATUALIZAR` ou corrija a matrícula |
| `enrollid inválido` | número entre 1 e 99999999 |
| `foto inválida` | formato/tamanho fora do padrão; envie depois em Pessoas → Foto |
| `413` | reduza linhas/fotos ou aumente os limites no ambiente |
| Linha não aparece | confira o mapeamento de colunas e o cabeçalho |
