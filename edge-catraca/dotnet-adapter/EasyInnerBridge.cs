// Ponte entre o edge Node e a EasyInner.dll (modo On-line, Windows + .NET).
// Fala JSON por linha (NDJSON) em 127.0.0.1:5011 e faz o polling da catraca.
//
// Compilar (sem projeto, sem dependências):
//   powershell -ExecutionPolicy Bypass -File build.ps1
// Rodar:
//   EasyInnerBridge.exe --port 5011 --inner 1 --porta-inner 3000
// Simular sem hardware (para testar o edge):
//   EasyInnerBridge.exe --port 5011 --simulate
//
// O polling e todas as chamadas na DLL acontecem em UMA thread (a DLL não é
// thread-safe). O servidor TCP só lê comandos e escreve eventos.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

public static class EasyInnerRetorno
{
    public const int RET_COMANDO_OK = 0;
    public const int RET_COMANDO_ERRO = 1;
    public const int RET_PORTA_NAO_ABERTA = 2;
    public const int RET_PORTA_JA_ABERTA = 3;
}

public static class EasyInner
{
    private const string DLL = "EasyInner.dll";

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte DefinirTipoConexao(byte Tipo); // 2 = porta fixa (TCP)

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte DefinirPadraoCartao(byte Padrao);

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte ConfigurarInnerOnLine();

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte AbrirPortaComunicacao(int Porta);

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern void FecharPortaComunicacao();

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte ReceberRelogio(int Inner, ref byte Dia, ref byte Mes, ref byte Ano,
        ref byte Hora, ref byte Minuto, ref byte Segundo);

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte ReceberVersaoFirmware(int Inner, ref byte Linha, ref short Variacao,
        ref byte VersaoAlta, ref byte VersaoBaixa, ref byte VersaoSufixo, ref byte InnerAcessoBio);

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte EnviarRelogio(int Inner, byte Dia, byte Mes, byte Ano,
        byte Hora, byte Minuto, byte Segundo);

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte EnviarMensagemPadraoOnLine(int Inner, byte ExibirData, string Mensagem);

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte EnviarFormasEntradasOnLine(int Inner, byte QtdeDigitosTeclado,
        byte EcoTeclado, byte FormaEntrada, byte TempoTeclado, byte PosicaoCursorTeclado);

    [DllImport(DLL, CallingConvention = CallingConvention.Winapi)]
    public static extern byte AcionarBipLongo(int Inner);

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
    public static extern byte PingOnLine(int Inner);
}

public sealed class Bridge
{
    private readonly int porta;
    private readonly int inner;
    private readonly int portaInner;
    private readonly bool simular;
    private readonly bool teclado;
    private readonly int origemSaida;
    private readonly int padraoCartao;

    private readonly object travaSaida = new object();
    private readonly Queue<string> comandos = new Queue<string>();
    private TcpListener listener;
    private TcpClient cliente;
    private StreamWriter saida;
    private volatile bool rodando = true;
    private bool innerOk;

    public Bridge(int porta, int inner, int portaInner, bool simular, bool teclado, int origemSaida, int padraoCartao)
    {
        this.porta = porta;
        this.inner = inner;
        this.portaInner = portaInner;
        this.simular = simular;
        this.teclado = teclado;
        this.origemSaida = origemSaida;
        this.padraoCartao = padraoCartao;
    }

    public void Rodar()
    {
        listener = new TcpListener(IPAddress.Loopback, porta);
        listener.Start();
        int efetiva = ((IPEndPoint)listener.LocalEndpoint).Port;
        Console.WriteLine("PORTA " + efetiva); // usado pelos testes para descobrir a porta
        Console.WriteLine("[bridge] ouvindo em 127.0.0.1:" + efetiva + (simular ? " (simulado)" : ""));

        Thread rede = new Thread(LacoRede);
        rede.IsBackground = true;
        rede.Start();

        Thread trabalho = new Thread(LacoTrabalho);
        trabalho.IsBackground = true;
        trabalho.Start();
        trabalho.Join();
    }

    // --------------------------------------------------------------- rede
    private void LacoRede()
    {
        while (rodando)
        {
            try
            {
                TcpClient novo = listener.AcceptTcpClient();
                novo.NoDelay = true;
                lock (travaSaida)
                {
                    FecharCliente();
                    cliente = novo;
                    saida = new StreamWriter(novo.GetStream(), new UTF8Encoding(false)) { AutoFlush = true };
                }
                Console.WriteLine("[bridge] edge conectado");
                Thread leitor = new Thread(() => LerCliente(novo));
                leitor.IsBackground = true;
                leitor.Start();
            }
            catch (Exception e)
            {
                if (rodando) Console.WriteLine("[bridge] accept: " + e.Message);
            }
        }
    }

    private void LerCliente(TcpClient origem)
    {
        try
        {
            StreamReader leitor = new StreamReader(origem.GetStream(), Encoding.UTF8);
            string linha;
            while (rodando && (linha = leitor.ReadLine()) != null)
            {
                if (linha.Trim().Length == 0) continue;
                lock (comandos) comandos.Enqueue(linha);
            }
        }
        catch (Exception e)
        {
            if (rodando) Console.WriteLine("[bridge] leitura: " + e.Message);
        }
        finally
        {
            lock (travaSaida)
            {
                if (cliente == origem) FecharCliente();
            }
            Console.WriteLine("[bridge] edge desconectado");
        }
    }

    private void FecharCliente()
    {
        try { if (saida != null) saida.Dispose(); } catch { }
        try { if (cliente != null) cliente.Close(); } catch { }
        saida = null;
        cliente = null;
    }

    private void Enviar(string json)
    {
        lock (travaSaida)
        {
            if (saida == null) return;
            try { saida.WriteLine(json); }
            catch { FecharCliente(); }
        }
    }

    private void Status(bool conectado, string erro)
    {
        innerOk = conectado;
        string json = "{\"evento\":\"status\",\"conectado\":" + (conectado ? "true" : "false")
            + (erro != null ? ",\"erro\":\"" + Escapar(erro) + "\"" : "") + "}";
        Enviar(json);
    }

    // ----------------------------------------------------------- trabalho
    private void LacoTrabalho()
    {
        if (!simular && !AbrirInner())
        {
            while (rodando)
            {
                Thread.Sleep(5000);
                if (AbrirInner()) break;
            }
            if (!rodando) return;
        }

        DateTime ultimoEvento = DateTime.Now;
        int falhasPing = 0;

        while (rodando)
        {
            string cmd = null;
            lock (comandos)
            {
                if (comandos.Count > 0) cmd = comandos.Dequeue();
            }
            if (cmd != null) Processar(cmd);

            if (simular)
            {
                Thread.Sleep(25);
                continue;
            }

            try
            {
                string cartao;
                string direcao;
                byte origem = 0, complemento = 0, dia = 0, mes = 0, ano = 0, hora = 0, minuto = 0, segundo = 0;
                StringBuilder sb = new StringBuilder(64);
                byte ret = EasyInner.ReceberDadosOnLine(inner, ref origem, ref complemento, sb,
                    ref dia, ref mes, ref ano, ref hora, ref minuto, ref segundo);
                if (ret == EasyInnerRetorno.RET_COMANDO_OK && sb.Length > 0)
                {
                    cartao = sb.ToString().Trim();
                    if (cartao.Length > 0)
                    {
                        direcao = origem == origemSaida ? "OUT" : "IN";
                        int anoCompleto = ano < 100 ? 2000 + ano : ano;
                        string quando = new DateTime(anoCompleto, mes, dia, hora, minuto, segundo).ToString("s");
                        Enviar("{\"evento\":\"cartao\",\"cartao\":\"" + Escapar(cartao)
                            + "\",\"direcao\":\"" + direcao + "\",\"origem\":" + origem
                            + ",\"dataHora\":\"" + quando + "\"}");
                        Console.WriteLine("[bridge] evento cartao=" + cartao + " " + direcao);
                        ultimoEvento = DateTime.Now;
                        falhasPing = 0;
                    }
                }

                if ((DateTime.Now - ultimoEvento).TotalSeconds >= 3)
                {
                    byte ping = EasyInner.PingOnLine(inner);
                    if (ping != EasyInnerRetorno.RET_COMANDO_OK)
                    {
                        falhasPing++;
                        if (falhasPing >= 3)
                        {
                            Status(false, "sem resposta ao ping");
                            ReabrirInner();
                            falhasPing = 0;
                            ultimoEvento = DateTime.Now;
                        }
                    }
                    else falhasPing = 0;
                }
            }
            catch (Exception e)
            {
                Status(false, e.Message);
                ReabrirInner();
                ultimoEvento = DateTime.Now;
            }
            Thread.Sleep(20);
        }
    }

    private void ReabrirInner()
    {
        try { EasyInner.FecharPortaComunicacao(); } catch { }
        Thread.Sleep(1000);
        AbrirInner();
    }

    private bool AbrirInner()
    {
        try
        {
            byte ret = EasyInner.DefinirTipoConexao(2);
            if (ret != EasyInnerRetorno.RET_COMANDO_OK) { Status(false, "DefinirTipoConexao=" + ret); return false; }
            EasyInner.DefinirPadraoCartao((byte)padraoCartao);
            ret = EasyInner.ConfigurarInnerOnLine();
            if (ret != EasyInnerRetorno.RET_COMANDO_OK) { Status(false, "ConfigurarInnerOnLine=" + ret); return false; }
            ret = EasyInner.AbrirPortaComunicacao(portaInner);
            if (ret != EasyInnerRetorno.RET_COMANDO_OK && ret != EasyInnerRetorno.RET_PORTA_JA_ABERTA)
            {
                Status(false, "AbrirPortaComunicacao(" + portaInner + ")=" + ret);
                return false;
            }

            byte dia = 0, mes = 0, ano = 0, hora = 0, minuto = 0, segundo = 0;
            ret = EasyInner.ReceberRelogio(inner, ref dia, ref mes, ref ano, ref hora, ref minuto, ref segundo);
            if (ret != EasyInnerRetorno.RET_COMANDO_OK) { Status(false, "ReceberRelogio=" + ret); return false; }

            byte linha = 0, vAlta = 0, vBaixa = 0, sufixo = 0, bio = 0;
            short variacao = 0;
            EasyInner.ReceberVersaoFirmware(inner, ref linha, ref variacao, ref vAlta, ref vBaixa, ref sufixo, ref bio);

            DateTime agora = DateTime.Now;
            EasyInner.EnviarRelogio(inner, (byte)agora.Day, (byte)agora.Month, (byte)(agora.Year % 100),
                (byte)agora.Hour, (byte)agora.Minute, (byte)agora.Second);

            if (teclado)
            {
                // Necessário só se a catraca tiver teclado para senha/cartão digitado.
                // Assinatura: (inner, qtdeDigitos, eco, formaEntrada, tempoTeclado, posicaoCursor).
                EasyInner.EnviarFormasEntradasOnLine(inner, 0, 0, 0, 0, 0);
            }
            EasyInner.EnviarMensagemPadraoOnLine(inner, 1, " ACESSO LIBERADO ");
            Status(true, null);
            Console.WriteLine("[bridge] EasyInner on-line (inner " + inner + ", porta " + portaInner + ")");
            return true;
        }
        catch (DllNotFoundException)
        {
            Status(false, "EasyInner.dll nao encontrada (regsvr32/instalador do SDK)");
            return false;
        }
        catch (BadImageFormatException)
        {
            Status(false, "EasyInner.dll com plataforma incompativel (tente compilar x86)");
            return false;
        }
        catch (Exception e)
        {
            Status(false, e.Message);
            return false;
        }
    }

    // ----------------------------------------------------------- comandos
    private void Processar(string linha)
    {
        string cmd = Campo(linha, "cmd");
        string id = Campo(linha, "id");
        if (cmd == null) return;

        if (cmd == "simular")
        {
            if (!simular) { Responder(id, false, 0, "modo real"); return; }
            string cartao = Campo(linha, "cartao") ?? "1001";
            string direcao = Campo(linha, "direcao") == "OUT" ? "OUT" : "IN";
            Enviar("{\"evento\":\"cartao\",\"cartao\":\"" + Escapar(cartao)
                + "\",\"direcao\":\"" + direcao + "\",\"dataHora\":\"" + DateTime.Now.ToString("s") + "\"}");
            Responder(id, true, 0, null);
            return;
        }

        if (simular)
        {
            if (cmd == "liberar") Console.WriteLine("[bridge] (simulado) liberar " + (Campo(linha, "direcao") ?? "IN"));
            if (cmd == "mensagem") Console.WriteLine("[bridge] (simulado) display: " + (Campo(linha, "texto") ?? ""));
            Responder(id, true, 0, null);
            return;
        }

        try
        {
            byte ret;
            if (cmd == "liberar")
            {
                string direcao = Campo(linha, "direcao");
                ret = direcao == "OUT" ? EasyInner.LiberarCatracaSaida(inner) : EasyInner.LiberarCatracaEntrada(inner);
            }
            else if (cmd == "mensagem")
            {
                ret = EasyInner.EnviarMensagemPadraoOnLine(inner, 1, Campo(linha, "texto") ?? "");
            }
            else if (cmd == "ping")
            {
                ret = EasyInner.PingOnLine(inner);
            }
            else
            {
                Responder(id, false, -1, "comando desconhecido: " + cmd);
                return;
            }

            if (ret != EasyInnerRetorno.RET_COMANDO_OK && cmd == "liberar") EasyInner.AcionarBipLongo(inner);
            Responder(id, ret == EasyInnerRetorno.RET_COMANDO_OK, ret, ret == EasyInnerRetorno.RET_COMANDO_OK ? null : "ret=" + ret);
        }
        catch (Exception e)
        {
            Responder(id, false, -2, e.Message);
        }
    }

    private void Responder(string id, bool ok, int ret, string erro)
    {
        if (id == null) return;
        StringBuilder sb = new StringBuilder();
        sb.Append("{\"id\":").Append(id).Append(",\"ok\":").Append(ok ? "true" : "false")
          .Append(",\"ret\":").Append(ret);
        if (erro != null) sb.Append(",\"erro\":\"").Append(Escapar(erro)).Append("\"");
        sb.Append("}");
        Enviar(sb.ToString());
    }

    // ------------------------------------------------------------- util
    private static string Campo(string json, string nome)
    {
        Match texto = Regex.Match(json, "\"" + nome + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
        if (texto.Success) return Regex.Unescape(texto.Groups[1].Value);
        Match numero = Regex.Match(json, "\"" + nome + "\"\\s*:\\s*(-?\\d+)");
        return numero.Success ? numero.Groups[1].Value : null;
    }

    private static string Escapar(string texto)
    {
        if (texto == null) return "";
        return texto.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", " ");
    }
}

public static class Program
{
    public static int Main(string[] args)
    {
        int porta = 5011;
        int inner = 1;
        int portaInner = 3000;
        int origemSaida = 2;
        int padraoCartao = 1; // PADRAO_LIVRE no exemplo oficial
        bool simular = false;
        bool teclado = false;

        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i];
            if (a == "--simulate") simular = true;
            else if (a == "--teclado") teclado = true;
            else if (a == "--port" && i + 1 < args.Length) int.TryParse(args[++i], out porta);
            else if (a == "--inner" && i + 1 < args.Length) int.TryParse(args[++i], out inner);
            else if (a == "--porta-inner" && i + 1 < args.Length) int.TryParse(args[++i], out portaInner);
            else if (a == "--origem-saida" && i + 1 < args.Length) int.TryParse(args[++i], out origemSaida);
            else if (a == "--padrao-cartao" && i + 1 < args.Length) int.TryParse(args[++i], out padraoCartao);
        }

        Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs e)
        {
            e.Cancel = true;
            Environment.Exit(0);
        };

        try
        {
            new Bridge(porta, inner, portaInner, simular, teclado, origemSaida, padraoCartao).Rodar();
            return 0;
        }
        catch (Exception e)
        {
            Console.Error.WriteLine("[bridge] fatal: " + e.Message);
            return 1;
        }
    }
}
