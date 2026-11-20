# Adaptador real Windows (.NET) — implementar na bancada com a catraca

Este repositório desenvolve no Linux com simuladores. O código real do
hardware roda **só no Windows**, pois `EasyInner.dll` é nativa Windows e o
suporte Topdata distribui exemplos em C#/.NET.

## O que fazer no PC da portaria (Windows)

1. Instalar .NET 8 SDK.
2. Obter no Portal de Integradores Topdata: `SDK EasyInner` + `SDK Leitor Facial`.
3. Criar projeto Worker Service que implemente o mesmo contrato de
   `edge-catraca/src/simulators.js`:
   - `liberar(direcao)` → chama função de liberação da EasyInner.
   - `mensagem(texto)` → envia texto ao display.
   - identificação facial → cliente WebSocket que recebe o evento e faz
     `POST /api/identification` na API central (mesmo JSON do simulador).
4. Manter `USE_REAL_HARDWARE=1` só nesse ambiente.

## Template C# (ajustar nomes conforme header real do SDK recebido)

```csharp
using System.Runtime.InteropServices;

public sealed class EasyInnerReal
{
    // TODO: conferir assinatura exata no header .h / exemplo C# do SDK.
    // Os nomes abaixo são PLACEHOLDERS do contrato, não a assinatura Topdata.
    [DllImport("EasyInner.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern int EI_LiberarCatraca(int equipamento, int direcao);

    [DllImport("EasyInner.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern int EI_EnviarMensagem(int equipamento, string texto);

    private readonly int _equipamento;
    public EasyInnerReal(int equipamento) { _equipamento = equipamento; }

    public bool Liberar(int direcao) => EI_LiberarCatraca(_equipamento, direcao) == 0;
    public bool Mensagem(string texto) => EI_EnviarMensagem(_equipamento, texto) == 0;
}
```

Regras:
- Nunca commitar `EasyInner.dll` nem PDFs do Portal se a licença Topdata proibir.
- Todo retorno da DLL deve ser logado com código + timestamp para replay contra o simulador.
