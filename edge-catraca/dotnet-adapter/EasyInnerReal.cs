// Adaptador real EasyInner — modo On-line. Windows + .NET apenas.
// Requer EasyInner.dll registrada (regsvr32) ou instalador do Portal do Integrador.
// Extraído do exemplo oficial "SDK Inner Acesso Online" (C#).
// DLL e manuais NÃO são commitados — obter no Portal do Integrador Topdata.

using System.Runtime.InteropServices;
using System.Text;

public static class EasyInnerRetorno
{
    public const int RET_COMANDO_OK = 0;
    public const int RET_COMANDO_ERRO = 1;
    public const int RET_PORTA_NAO_ABERTA = 2;
    public const int RET_PORTA_JA_ABERTA = 3;
}

public static class EasyInnerReal
{
    private const string DLL = "EasyInner.dll";

    // ---- Conexão ----
    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte DefinirTipoConexao(byte Tipo); // 2 = porta fixa (TCP)

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte DefinirPadraoCartao(byte Padrao); // PADRAO_LIVRE no exemplo

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte ConfigurarInnerOnLine();

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte AbrirPortaComunicacao(int Porta);

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern void FecharPortaComunicacao();

    // ---- Diagnóstico / identificação ----
    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte ReceberRelogio(int Inner, ref byte Dia, ref byte Mes, ref byte Ano,
        ref byte Hora, ref byte Minuto, ref byte Segundo);

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte ReceberVersaoFirmware(int Inner, ref byte Linha, ref short Variacao,
        ref byte VersaoAlta, ref byte VersaoBaixa, ref byte VersaoSufixo, ref byte InnerAcessoBio);

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte EnviarRelogio(int Inner, byte Dia, byte Mes, byte Ano,
        byte Hora, byte Minuto, byte Segundo);

    // ---- Mensagens / sinalização ----
    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte EnviarMensagemPadraoOnLine(int Inner, byte ExibirData, string Mensagem);

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte EnviarMensagemTemporariaOnLine(int Inner, byte ExibirData, string Mensagem, byte Tempo);

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte EnviarFormasEntradasOnLine(int Inner, byte QtdeDigitosTeclado,
        byte EcoTeclado, byte FormaEntrada, byte TempoTeclado, byte PosicaoCursorTeclado);

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte AcionarBipCurto(int Inner);

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte AcionarBipLongo(int Inner);

    // ---- Polling + liberação ----
    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte ReceberDadosOnLine(int Inner, ref byte Origem, ref byte Complemento,
        StringBuilder Cartao, ref byte Dia, ref byte Mes, ref byte Ano,
        ref byte Hora, ref byte Minuto, ref byte Segundo);

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte LiberarCatracaEntrada(int Inner);

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte LiberarCatracaSaida(int Inner);

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte LiberarCatracaDoisSentidos(int Inner);

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte LiberarCatracaEntradaInvertida(int Inner);

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte LiberarCatracaSaidaInvertida(int Inner);

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte PingOnLine(int Inner);
}
