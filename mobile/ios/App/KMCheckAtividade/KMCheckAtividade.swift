import SwiftUI
import WidgetKit
import ActivityKit

/*
 * Extensão que DESENHA o cartão do KM (Atividade ao Vivo). Quem liga e atualiza é o app (App/KMAtividade.swift);
 * aqui só chega o estado (KMAtividadeAtributos.ContentState) e o iOS pede a vista de cada lugar:
 *  - tela bloqueada e banner: cartão grande (família "medium");
 *  - Ilha Dinâmica: compacta (mini placa + KM), mínima (só a placa) e aberta (ao tocar e segurar);
 *  - painel do CarPlay (iOS 26) e Apple Watch: família "small" (supplementalActivityFamilies).
 * O desenho é o do Modo Carro do app (aprovado pelo Wagner): grafite acetinado com o fio de luz verde, placa azul
 * de marco quilométrico, BR em verde-limão, KM grande prateado e a barra até o próximo KM.
 * Limite da Apple: o cartão da tela bloqueada tem no máximo 160 pt de altura — o grande foi medido para ~148 pt.
 */

@main
struct KMCheckAtividadeBundle: WidgetBundle {
    var body: some Widget {
        KMAtividadeWidget()
    }
}

struct KMAtividadeWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: KMAtividadeAtributos.self) { ctx in
            CartaoKM(e: ctx.state, velho: ctx.isStale)
                .activityBackgroundTint(Cor.fundo)
                .activitySystemActionForegroundColor(Cor.lima)
        } dynamicIsland: { ctx in
            let v = Vista(ctx.state, velho: ctx.isStale)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Placa(br: v.br, km: v.kmPlaca, largura: 50).padding(.leading, 4).padding(.top, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    /* o sentido já vai na linha de baixo (Rodape), junto da estaca */
                    Group { if v.e.dupla && !v.apagado { ChipDupla() } }
                        .padding(.trailing, 4).padding(.top, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(v.rodovia).font(.system(size: 14, weight: .heavy)).foregroundColor(Cor.lima).lineLimit(1)
                        TextoKM(v.kmTexto, tamanho: 38).opacity(v.apagado ? 0.45 : 1)
                        Rotulo(tamanho: 8.5)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 7) {
                        Trilho(prog: v.prog, apagado: v.apagado)
                        Rodape(v: v, tamanho: 12)
                    }
                    .padding(.horizontal, 6).padding(.bottom, 2)
                }
            } compactLeading: {
                MiniPlaca(km: v.kmInteiro).frame(width: 20, height: 24)
            } compactTrailing: {
                Text(v.kmTexto).font(.system(size: 15, weight: .heavy)).monospacedDigit()
                    .foregroundColor(v.apagado ? Cor.cinza : .white).lineLimit(1).minimumScaleFactor(0.7)
            } minimal: {
                MiniPlaca(km: v.kmInteiro).frame(width: 20, height: 24)
            }
            .keylineTint(Cor.lima)
        }
        .supplementalActivityFamilies([.small])
    }
}

// MARK: - Cores (as do Modo Carro do app)

enum Cor {
    static let lima = Color(red: 0xc4 / 255, green: 0xe2 / 255, blue: 0x4a / 255)        // #c4e24a
    static let azul = Color(red: 0x13 / 255, green: 0x30 / 255, blue: 0x5c / 255)        // #13305c (placa)
    static let ambar = Color(red: 0xff / 255, green: 0xb8 / 255, blue: 0x1c / 255)       // #ffb81c
    static let ambarTexto = Color(red: 0xff / 255, green: 0xcf / 255, blue: 0x5a / 255)  // #ffcf5a
    static let texto = Color(red: 0xe2 / 255, green: 0xe4 / 255, blue: 0xe8 / 255)       // #e2e4e8
    static let rotulo = Color(red: 0xcf / 255, green: 0xd2 / 255, blue: 0xd7 / 255)      // #cfd2d7
    static let cinza = Color(red: 0x8a / 255, green: 0x8e / 255, blue: 0x96 / 255)
    static let fundo = Color(red: 0x16 / 255, green: 0x17 / 255, blue: 0x1a / 255)
    static func hex(_ v: UInt32) -> Color {
        Color(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
    }
}

// MARK: - O que mostrar (mesma conta do paintCar do index.html)

struct Vista {
    let e: KMAtividadeAtributos.ContentState
    let velho: Bool

    init(_ e: KMAtividadeAtributos.ContentState, velho: Bool) { self.e = e; self.velho = velho }

    private var semRodovia: Bool { e.br.isEmpty }
    /** fora do eixo ou sem atualização (app fechado / sem GPS): o número fica apagado */
    var apagado: Bool { e.fora || velho || semRodovia }

    var br: String { semRodovia ? "—" : e.br }
    var rodovia: String { semRodovia ? "KM Check" : (e.uf.isEmpty ? e.br : "\(e.br)/\(e.uf)") }
    var kmInteiro: Int { Int(floor(e.km + 1e-9)) }
    var kmPlaca: String { semRodovia ? "—" : String(format: "%03d", max(0, kmInteiro)) }
    var kmTexto: String {
        if semRodovia { return "—" }
        let f = NumberFormatter()
        f.locale = Locale(identifier: "pt_BR")
        f.minimumFractionDigits = 3
        f.maximumFractionDigits = 3
        f.usesGroupingSeparator = true
        return f.string(from: NSNumber(value: e.km)) ?? String(format: "%.3f", e.km)
    }
    var sentidoTexto: String? { e.sentido > 0 ? "↑ Crescente" : (e.sentido < 0 ? "↓ Decrescente" : nil) }

    /** quanto falta para o próximo KM no sentido em que o carro anda (parado = como crescente) */
    private var conta: (prox: Int, falta: Double, prog: Double) {
        let base = kmInteiro, frac = e.km - Double(base)
        if e.sentido >= 0 { return (base + 1, (1 - frac) * 1000, frac) }
        if frac < 1e-6 { return (max(0, base - 1), 1000, 0) }
        return (base, frac * 1000, 1 - frac)
    }
    var prog: Double { apagado ? 0 : min(1, max(0, conta.prog)) }
    var faltaTexto: String {
        let f = NumberFormatter()
        f.locale = Locale(identifier: "pt_BR")
        f.maximumFractionDigits = 0
        return (f.string(from: NSNumber(value: conta.falta.rounded())) ?? "\(Int(conta.falta.rounded()))") + " m"
    }
    var proxTexto: String { " para o km \(conta.prox)" }
    /** quando não há "x m para o km y": o porquê */
    var aviso: String? {
        if semRodovia { return "Procurando a rodovia…" }
        if velho { return "Abra o KM Check para atualizar" }
        if e.fora { return "Fora do eixo da rodovia" }
        return nil
    }
    var detalhe: String {
        [e.estaca.isEmpty ? nil : "Est. \(e.estaca)", sentidoTexto].compactMap { $0 }.joined(separator: " · ")
    }
}

// MARK: - Cartão (tela bloqueada) e versão pequena (CarPlay / Watch)

struct CartaoKM: View {
    let e: KMAtividadeAtributos.ContentState
    let velho: Bool
    @Environment(\.activityFamily) private var familia

    var body: some View {
        let v = Vista(e, velho: velho)
        if familia == .small {
            CartaoPequeno(v: v).background(Cetim())
        } else {
            CartaoGrande(v: v).background(Cetim())
        }
    }
}

struct CartaoGrande: View {
    let v: Vista
    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 12) {
                Placa(br: v.br, km: v.kmPlaca, largura: 58)
                VStack(alignment: .leading, spacing: 2) {
                    Text(v.rodovia).font(.system(size: 15, weight: .heavy)).foregroundColor(Cor.lima)
                        .lineLimit(1).frame(height: 18)
                    TextoKM(v.kmTexto, tamanho: 44).frame(height: 42).opacity(v.apagado ? 0.45 : 1)
                    Rotulo(tamanho: 9).frame(height: 11)
                }
                Spacer(minLength: 0)
            }
            /* chip da pista dupla no canto, por cima: não rouba largura do KM */
            .overlay(alignment: .topTrailing) { if v.e.dupla && !v.apagado { ChipDupla() } }
            Trilho(prog: v.prog, apagado: v.apagado).padding(.top, 10)
            Rodape(v: v, tamanho: 13).padding(.top, 7)
        }
        .padding(EdgeInsets(top: 13, leading: 16, bottom: 12, trailing: 16))
    }
}

/** CarPlay (painel ao lado do mapa) e Apple Watch: o essencial — placa, BR, KM e a barra */
struct CartaoPequeno: View {
    let v: Vista
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .center, spacing: 8) {
                Placa(br: v.br, km: v.kmPlaca, largura: 34)
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 5) {
                        Text(v.rodovia).font(.system(size: 12, weight: .heavy)).foregroundColor(Cor.lima).lineLimit(1)
                        if v.e.dupla && !v.apagado { Circle().fill(Cor.ambar).frame(width: 6, height: 6) }
                    }
                    TextoKM(v.kmTexto, tamanho: 28).opacity(v.apagado ? 0.45 : 1)
                }
                Spacer(minLength: 0)
            }
            Trilho(prog: v.prog, apagado: v.apagado, fino: true)
            Group {
                if let a = v.aviso {
                    Text(a).foregroundColor(Cor.ambarTexto)
                } else {
                    Text(v.faltaTexto).foregroundColor(Cor.lima).fontWeight(.heavy) + Text(v.proxTexto).foregroundColor(Cor.texto)
                }
            }
            .font(.system(size: 11, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.7)
        }
        .padding(10)
    }
}

// MARK: - Peças

/** "650 m para o km 42" à esquerda e "Est. 2067+10 · ↑ Crescente" à direita (ou o aviso, quando não há KM) */
struct Rodape: View {
    let v: Vista
    let tamanho: CGFloat
    var body: some View {
        HStack(spacing: 8) {
            if let a = v.aviso {
                Text(a).foregroundColor(Cor.ambarTexto).font(.system(size: tamanho, weight: .semibold))
            } else {
                (Text(v.faltaTexto).foregroundColor(Cor.lima).fontWeight(.heavy) + Text(v.proxTexto).foregroundColor(Cor.texto))
                    .font(.system(size: tamanho, weight: .medium)).monospacedDigit()
            }
            Spacer(minLength: 4)
            if !v.detalhe.isEmpty && !v.apagado {
                Text(v.detalhe).font(.system(size: tamanho - 1, weight: .semibold)).foregroundColor(Cor.rotulo)
                    .monospacedDigit()
            }
        }
        .lineLimit(1).minimumScaleFactor(0.75)
    }
}

/** KM grande prateado (branco que escurece um pouco embaixo, como o .km do Modo Carro) */
struct TextoKM: View {
    let texto: String
    let tamanho: CGFloat
    init(_ texto: String, tamanho: CGFloat) { self.texto = texto; self.tamanho = tamanho }
    var body: some View {
        Text(texto)
            .font(.system(size: tamanho, weight: .heavy)).monospacedDigit().kerning(-tamanho * 0.03)
            .foregroundStyle(LinearGradient(stops: [.init(color: .white, location: 0), .init(color: .white, location: 0.55),
                                                    .init(color: Cor.hex(0xdfe3e8), location: 1)],
                                            startPoint: .top, endPoint: .bottom))
            .shadow(color: .black.opacity(0.55), radius: 7, y: 4)
            .lineLimit(1).minimumScaleFactor(0.55)
    }
}

/** "QUILÔMETRO" espaçado */
struct Rotulo: View {
    let tamanho: CGFloat
    var body: some View {
        Text("QUILÔMETRO").font(.system(size: tamanho, weight: .medium)).kerning(tamanho * 0.42)
            .foregroundColor(Cor.rotulo).lineLimit(1)
    }
}

/** trilho rebaixado com o preenchimento verde e a bolinha branca: onde o carro está dentro do KM */
struct Trilho: View {
    let prog: Double
    var apagado = false
    var fino = false
    var body: some View {
        let alto: CGFloat = fino ? 4 : 6, bola: CGFloat = fino ? 10 : 15
        GeometryReader { g in
            let w = g.size.width, x = max(bola / 2, min(w - bola / 2, w * prog))
            ZStack(alignment: .leading) {
                Capsule().fill(LinearGradient(colors: [Cor.hex(0x0a0b0c), Cor.hex(0x18191b)], startPoint: .top, endPoint: .bottom))
                    .overlay(Capsule().stroke(Color.white.opacity(0.06), lineWidth: 0.5))
                    .frame(height: alto)
                if !apagado {
                    Capsule().fill(LinearGradient(colors: [Cor.hex(0x8eb31f), Cor.hex(0xc6e64c)], startPoint: .leading, endPoint: .trailing))
                        .frame(width: max(alto, w * prog), height: alto)
                        .shadow(color: Cor.lima.opacity(0.35), radius: 5)
                    Circle()
                        .fill(RadialGradient(colors: [.white, Cor.hex(0xe4e7ea)], center: UnitPoint(x: 0.4, y: 0.3), startRadius: 0, endRadius: bola * 0.6))
                        .frame(width: bola, height: bola)
                        .overlay(Circle().stroke(Cor.lima.opacity(0.22), lineWidth: 3).frame(width: bola + 4, height: bola + 4))
                        .shadow(color: .black.opacity(0.6), radius: 3, y: 2)
                        .position(x: x, y: g.size.height / 2)
                }
            }
            .frame(height: g.size.height)
        }
        .frame(height: bola)
    }
}

struct Chip: View {
    let texto: String
    var body: some View {
        Text(texto).font(.system(size: 11, weight: .bold)).foregroundColor(Cor.texto).lineLimit(1)
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background(Capsule().fill(Color.white.opacity(0.06)))
            .overlay(Capsule().stroke(Color.white.opacity(0.10), lineWidth: 1))
    }
}

/** "● Pista dupla" em âmbar (o mesmo aviso da câmera) */
struct ChipDupla: View {
    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(Cor.ambar).frame(width: 7, height: 7).shadow(color: Cor.ambar.opacity(0.7), radius: 4)
            Text("Pista dupla").font(.system(size: 11, weight: .bold)).foregroundColor(Cor.ambarTexto).lineLimit(1)
        }
        .padding(.horizontal, 9).padding(.vertical, 4)
        .background(Capsule().fill(Cor.ambar.opacity(0.08)))
        .overlay(Capsule().stroke(Cor.ambar.opacity(0.35), lineWidth: 1))
    }
}

/** placa azul de marco quilométrico (a mesma #car-plate do app, desenho de 150×178) */
struct Placa: View {
    let br: String
    let km: String
    let largura: CGFloat
    var body: some View {
        let s = largura / 150
        ZStack {
            RoundedRectangle(cornerRadius: 14 * s).fill(Color.white)
            RoundedRectangle(cornerRadius: 9 * s).fill(Cor.azul).padding(8 * s)
            VStack(spacing: 0) {
                Text(br).font(.system(size: 31 * s, weight: .heavy)).lineLimit(1).minimumScaleFactor(0.6)
                    .frame(width: 124 * s, height: 46 * s, alignment: .bottom)
                Rectangle().fill(Color.white).frame(width: 102 * s, height: 3 * s).padding(.top, 6 * s)
                Text("KM").font(.system(size: 34 * s, weight: .heavy)).frame(height: 40 * s, alignment: .bottom)
                Text(km).font(.system(size: 42 * s, weight: .heavy)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
                    .frame(width: 124 * s, height: 46 * s)
            }
            .foregroundColor(.white)
            .frame(height: 178 * s, alignment: .top)
            .padding(.top, 8 * s)
        }
        .frame(width: largura, height: 178 * s)
        .shadow(color: .black.opacity(0.6), radius: max(2, 30 * s), y: max(1, 20 * s))
    }
}

/** placa mínima da Ilha Dinâmica: "KM / 41" */
struct MiniPlaca: View {
    let km: Int
    var body: some View {
        GeometryReader { g in
            let s = g.size.width / 150
            ZStack {
                RoundedRectangle(cornerRadius: 18 * s).fill(Color.white)
                RoundedRectangle(cornerRadius: 12 * s).fill(Cor.azul).padding(12 * s)
                VStack(spacing: 0) {
                    Text("KM").font(.system(size: 52 * s, weight: .black))
                    Text("\(max(0, km))").font(.system(size: 56 * s, weight: .black)).lineLimit(1).minimumScaleFactor(0.5)
                }
                .foregroundColor(.white)
                .padding(.horizontal, 14 * s)
            }
        }
    }
}

/** material do Modo Carro: grafite acetinado, dobra de cetim e o fio de luz verde no canto */
struct Cetim: View {
    var body: some View {
        ZStack {
            LinearGradient(stops: [.init(color: Cor.hex(0x30333a), location: 0), .init(color: Cor.hex(0x22252a), location: 0.30),
                                   .init(color: Cor.hex(0x18191d), location: 0.62), .init(color: Cor.hex(0x0f1012), location: 1)],
                           startPoint: UnitPoint(x: 0.4, y: 0), endPoint: UnitPoint(x: 0.6, y: 1))
            RadialGradient(colors: [Color.white.opacity(0.12), .clear], center: UnitPoint(x: 0.12, y: -0.08), startRadius: 0, endRadius: 240)
            RadialGradient(colors: [Color.black.opacity(0.5), .clear], center: UnitPoint(x: 1.05, y: 1.1), startRadius: 0, endRadius: 220)
            GeometryReader { g in
                let w = g.size.width, h = g.size.height
                /* dobra do cetim: uma onda clara atravessando o cartão */
                Path { p in
                    p.move(to: CGPoint(x: 0, y: h * 0.62))
                    p.addCurve(to: CGPoint(x: w, y: h * 0.51), control1: CGPoint(x: w * 0.25, y: h * 0.47), control2: CGPoint(x: w * 0.55, y: h * 0.76))
                }
                .stroke(LinearGradient(colors: [.clear, Color.white.opacity(0.18), Color.white.opacity(0.06), .clear], startPoint: .leading, endPoint: .trailing), lineWidth: 1)
                /* fio de luz verde-limão subindo no canto direito (com brilho) */
                let fio = Path { p in
                    p.move(to: CGPoint(x: w * 0.55, y: h))
                    p.addCurve(to: CGPoint(x: w, y: h * 0.69), control1: CGPoint(x: w * 0.72, y: h * 0.89), control2: CGPoint(x: w * 0.86, y: h * 0.73))
                }
                let tinta = LinearGradient(colors: [Cor.lima.opacity(0), Cor.lima.opacity(0.55), Cor.hex(0xd6f06a).opacity(0.75)], startPoint: .leading, endPoint: .trailing)
                fio.stroke(tinta, lineWidth: 3).blur(radius: 3).opacity(0.45)
                fio.stroke(tinta, lineWidth: 0.9)
            }
        }
    }
}
