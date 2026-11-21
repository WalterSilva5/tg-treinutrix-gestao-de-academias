# Segurança e LGPD

## Sessão

- Login emite **cookie HttpOnly** `painel_token` (`SameSite=Lax`, `Max-Age` de
  12 h). O token **não** fica mais no `localStorage`; o navegador envia o cookie
  automaticamente.
- Compatibilidade: `Authorization: Bearer` continua aceito para o edge, scripts
  e integrações.
- `COOKIE_SECURE=1` quando o painel estiver atrás de HTTPS.
- Logout invalida os tokens do usuário (incrementa `tokenVersion`) e limpa o
  cookie. Trocar a senha também invalida sessões antigas e emite uma nova.
- Tokens carregam `ver` (versão do usuário) e `epoch` (global). Mudanças de
  senha/logout derrubam tokens antigos.
- `mustChangePassword`: cadastros criados/importados sem senha explícita
  precisam trocar antes de executar ações de escrita. `SEED_ADMIN_MUST_CHANGE=1`
  aplica ao admin inicial.

## Cabeçalhos e CSRF

- `Content-Security-Policy` (self, inline necessário para o painel single-file),
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: same-origin`, `Permissions-Policy` restritiva.
- Cookie `SameSite=Lax` + API sem CORS por padrão mitigam CSRF. Se habilitar
  `CORS_ORIGIN`, restrinja a uma origem confiável.
- Fotos usam o cookie; não é mais necessário `?t=<token>`.

## Limites de uso

| Operação | Limite |
|----------|--------|
| Login | 5 falhas / 5 min por IP |
| Inscrição pública | 20 / 10 min por IP |
| Descoberta de catraca | 5 varreduras / 10 min por IP |
| Importação | 10 / hora por usuário |
| Exportações CSV/PDF | 60 / 10 min por IP |

## Auditoria

- `GET /api/audit` (gerência) lista as últimas ações.
- Registra: importação, sorteio/reset/entrega, exclusões (pessoa, evento,
  dispositivo, sorteio), troca de senha, logout, restauração de backup.
- Cada registro tem data, autor, perfil, IP, ação e detalhe; mantém 2.000.
- Visível em **Sistema → Auditoria**.

## Retenção (LGPD)

Configurável por ambiente; roda no boot e a cada `RETENTION_INTERVAL_HOURS`:

| Variável | Padrão | Efeito |
|----------|--------|--------|
| `RETENTION_EVENT_DAYS` | 365 | remove eventos de acesso antigos |
| `RETENTION_EXTERNAL_DAYS` | 365 | anonimiza participantes externos antigos (nome/contato/documento) |
| `RETENTION_SOCIAL_DAYS` | 0 | remove eventos da agenda encerrados (e inscrições) |
| `RETENTION_PHOTO_DAYS` | 0 | remove foto de pessoa **inativa** após o prazo |
| `RETENTION_INTERVAL_HOURS` | 24 | frequência da rotina; 0 desliga |

Recomendação: definir os prazos com a academia/advogado e manter backup com
retenção própria. Fotos são dado biométrico sensível: consentimento e exclusão
sob solicitação.

## Checklist antes de expor fora da LAN

- [ ] HTTPS (proxy reverso) e `COOKIE_SECURE=1`.
- [ ] `AUTH_SECRET`/`data/auth.secret` protegido; backup seguro.
- [ ] Trocar `admin123` e senhas iniciais dos alunos.
- [ ] Firewall limitado à rede da academia.
- [ ] Revisar `CORS_ORIGIN` (deixar vazio se o PWA é servido pela API).
- [ ] Testar restore e retenção.
