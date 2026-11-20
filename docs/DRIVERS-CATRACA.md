# Suporte a catracas e controladores

O sistema separa **decisão de acesso** (API) do **acionamento físico** (edge).
Cada equipamento é cadastrado com um `driver`; trocar de marca não muda as regras
de negócio nem os eventos.

## Drivers disponíveis

| Driver | Fabricante | Modelos | Transporte | Requisitos |
|--------|-----------|---------|------------|------------|
| `topdata_easyinner` | Topdata | Fit 4, Revolution 4, Box 4, PNE 4 | TCP/IP + `EasyInner.dll` | Windows + DLL do Portal do Integrador |
| `topdata_facial_ws` | Topdata | Leitor Facial F4, T4, T4-50k | WebSocket | Servidor WS no edge |
| `generic_http` | Compatível | Relé TCP/HTTP, controlador de acesso, porta giratória | HTTP POST | Endpoint na rede local |
| `simulator` | — | Ambiente de testes | Local | Nenhum |

Catálogo servido por `GET /api/device-catalog`; cadastro em `POST /api/devices`
(só gerência) com validação em `api/src/devices.js`.

## Contrato do driver genérico (`generic_http`)

O edge faz, ao liberar:

```http
POST http://<ip>:<porta>/open
Content-Type: application/json

{ "action": "open", "direction": "IN", "device": "dev_xxx" }
```

Sucesso = HTTP 2xx. É o suficiente para acionar relés, placas de porta e
controladores com API HTTP. Configuração no edge:

```bash
DEVICE_DRIVER=generic_http \
DEVICE_ENDPOINT=http://192.168.0.50/open \
DEVICE_ID=dev_000 \
node edge-catraca/src/edge.js
```

## Como integrar uma marca nova

1. Descobrir o transporte do equipamento (HTTP, TCP proprietário, SDK nativo, Wiegand).
2. Se for HTTP, usar `generic_http` direto — sem código novo.
3. Se for SDK/DLL, criar um driver no edge com o mesmo contrato de
   `edge-catraca/src/simulators.js`:
   - `liberar(direcao)` → aciona o giro
   - `mensagem(texto)` → display, se existir
   - evento de identificação → `POST /api/identification`
4. Cadastrar o driver em `api/src/devices.js` (nome, modelos, requisitos).
5. Documentar em `docs/` e adicionar teste em `api/test/devices.test.js`.

## Observações por marca

- **Topdata linha Inner:** facial integrado envia o `enrollid` pela conexão física;
  a catraca repassa via `ReceberDadosOnLine` (DLL). Ver `SDK-EASYINNER-MAPEAMENTO.md`.
- **Topdata linha Easy:** o próprio leitor libera; sem DLL. Confirmação via WebSocket.
- **Outras marcas com SDK Windows:** o driver roda no mesmo PC do edge (Windows),
  mantendo a API em Linux se necessário.
- **Wiegand puro:** exige controlador com entrada Wiegand + API/serial; usar
  `generic_http` no controlador, não na catraca.
