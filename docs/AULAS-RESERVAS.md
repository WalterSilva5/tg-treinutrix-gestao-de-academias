# Aulas, reservas e check-in

Agenda de aulas coletivas com reserva pelo PWA, lista de espera e presença.

## 1. Aula

| Campo | Regra |
|-------|-------|
| `nome` | obrigatório |
| `inicio` | obrigatório (data/hora) |
| `fim` | opcional; não pode ser antes do início |
| `professor`, `sala`, `observacoes` | opcionais |
| `capacidade` | `0`/vazio = sem limite; número = vagas |
| `ativo` | aula inativa não aparece para o aluno |

Endpoints (equipe): `GET/POST /api/classes`, `GET/PATCH/DELETE
/api/classes/:id`, `POST /api/classes/:id/checkin` com `{ codigo }`.
A listagem traz `reservados`, `presentes` e `espera`.

## 2. Reserva

- `POST /api/me/classes/:id/inscrever` (aluno autenticado).
- Com vaga: status `RESERVADO` e código de 6 caracteres hexadecimais.
- Sem vaga: status `ESPERA`.
- Uma reserva ativa por aluno/aula; aulas encerradas não aceitam reserva.
- `DELETE /api/me/classes/:id/inscricao` cancela; se houver lista de espera,
  **a primeira pessoa da fila é promovida** para `RESERVADO`
  (`promovidoEm`) e ocupa a vaga.
- `GET /api/me/classes` lista aulas futuras com vagas, reserva, status e código.

## 3. Check-in

- A recepção informa o código na tela **Aulas e agenda**.
- O código é comparado sem diferenciar maiúsculas/minúsculas.
- Sucesso: status `PRESENTE` e `checkinAt`; o detalhe da aula lista as reservas
  com nome/matrícula.
- Ainda não há bloqueio automático de no-show nem cobrança de falta.

## 4. Interface

- **Sistema → Aulas e agenda:** criar/excluir aula, ver ocupação e fazer
  check-in por código.
- **Meu acesso (aluno) → Próximas aulas:** reservar, entrar na espera,
  visualizar código e cancelar.

## 5. Limitações

- Reserva recorrente/semanal e série de aulas ainda não existem (crie cada
  sessão).
- Não há integração com plano (um aluno sem plano ativo ainda pode reservar).
- Notificação de vaga liberada é apenas visual; não há push/WhatsApp
  automático.
- A capacidade é checada no momento da reserva, sem trava distribuída; para
  múltiplas instâncias seria necessário controle transacional.
