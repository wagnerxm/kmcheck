import Foundation
import UIKit
import CoreLocation
import ActivityKit

/*
 * Atividade ao Vivo (iPhone): o cartão com o KM na tela bloqueada, na Ilha Dinâmica e no painel do CarPlay.
 *
 * Por que o KM é calculado aqui e não no index.html: com a tela bloqueada (ou o app no fundo) o iOS congela o
 * JavaScript do WebView. Quem continua rodando é só o GPS nativo (GpsNativo, no KMCheckNativoPlugin.swift, com o
 * modo de fundo "location"). Então o index.html manda, enquanto está na frente, o eixo das rodovias perto do carro
 * (já recortado e com as ligações fantasmas marcadas) e daqui para frente o KM sai deste motor — a mesma conta do
 * findKm do app, só que para essas poucas rodovias.
 *
 * Regras combinadas com o Wagner: o cartão liga sozinho com o carro a mais de 20 km/h numa rodovia (quem decide é o
 * index.html, que só chama com o app na frente — o iOS não deixa começar uma Atividade ao Vivo com o app no fundo)
 * e se desliga sozinho depois de 10 min parado. A chave "KM no CarPlay e na tela bloqueada" dos Ajustes desliga tudo.
 */

/** Uma rodovia como o index.html manda: eixo (lat/lon/km por ponto) recortado perto do carro. */
struct RodoviaAtv {
    let br: String
    let uf: String
    let lat: [Double]
    let lon: [Double]
    let km: [Double]
    /** ligações que não são estrada: fantasmas (ver basePhantom no index.html), trechos cedidos a outra BR e as
     *  emendas do recorte. Índice i = ligação entre o ponto i e o i+1. */
    let pula: [Bool]
    /** trechos de pista dupla do SNV, [kmIni, kmFim] */
    let dup: [[Double]]
    /** estacas de referência da base (Ajustes da rodovia): KM → estaca e + m metros */
    let refs: [(km: Double, e: Double, m: Double)]
    let la0: Double, la1: Double, lo0: Double, lo1: Double

    /** monta a partir do objeto que chega do JavaScript; nil se vier faltando algo */
    static func de(_ o: [String: Any]) -> RodoviaAtv? {
        func nums(_ v: Any?) -> [Double] { ((v as? [Any]) ?? []).map { ($0 as? NSNumber)?.doubleValue ?? .nan } }
        let lat = nums(o["lat"]), lon = nums(o["lon"]), km = nums(o["km"])
        let n = lat.count
        guard n >= 2, lon.count == n, km.count == n, let br = o["br"] as? String else { return nil }
        var pula = [Bool](repeating: false, count: n - 1)
        for v in (o["pula"] as? [Any]) ?? [] {
            if let i = (v as? NSNumber)?.intValue, i >= 0, i < n - 1 { pula[i] = true }
        }
        let dup = ((o["dup"] as? [Any]) ?? []).compactMap { par -> [Double]? in
            let p = nums(par); return p.count == 2 && p[0].isFinite && p[1].isFinite ? p : nil
        }
        let refs = ((o["refs"] as? [Any]) ?? []).compactMap { r -> (km: Double, e: Double, m: Double)? in
            let p = nums(r); return p.count == 3 && p.allSatisfy { $0.isFinite } ? (p[0], p[1], p[2]) : nil
        }
        var a = Double.infinity, b = -Double.infinity, c = Double.infinity, d = -Double.infinity
        for i in 0..<n where lat[i].isFinite && lon[i].isFinite {
            a = min(a, lat[i]); b = max(b, lat[i]); c = min(c, lon[i]); d = max(d, lon[i])
        }
        guard a.isFinite else { return nil }
        return RodoviaAtv(br: br, uf: (o["uf"] as? String) ?? "", lat: lat, lon: lon, km: km, pula: pula,
                          dup: dup, refs: refs, la0: a, la1: b, lo0: c, lo1: d)
    }
}

/** O findKm do index.html para as rodovias recebidas: ponto mais próximo do eixo e o KM interpolado nele. */
final class MotorKM {
    var rodovias: [RodoviaAtv] = []
    var maxdist: Double = 300

    private static let D2R = Double.pi / 180, R = 6371008.8   // os mesmos do index.html

    func acha(_ la: Double, _ lo: Double) -> (km: Double, dist: Double, r: Int)? {
        let cosL = cos(la * Self.D2R)
        var melhor: (d2: Double, km: Double, r: Int)?
        for (ri, r) in rodovias.enumerated() {
            /* poda: rodovia cuja caixa já está mais longe que o melhor achado nem é varrida */
            let dy = la < r.la0 ? r.la0 - la : (la > r.la1 ? la - r.la1 : 0)
            let dx = (lo < r.lo0 ? r.lo0 - lo : (lo > r.lo1 ? lo - r.lo1 : 0)) * cosL
            if let m = melhor, dx * dx + dy * dy > m.d2 { continue }
            for i in 0..<(r.lat.count - 1) where !r.pula[i] {
                let ax = r.lon[i], ay = r.lat[i]
                let vx = (r.lon[i + 1] - ax) * cosL, vy = r.lat[i + 1] - ay
                let ex = (lo - ax) * cosL, ey = la - ay
                let L2 = vx * vx + vy * vy
                if !(L2 > 0) { continue }   // também pula NaN
                var t = (ex * vx + ey * vy) / L2
                t = t < 0 ? 0 : (t > 1 ? 1 : t)
                let fx = ex - t * vx, fy = ey - t * vy
                let d2 = fx * fx + fy * fy
                if melhor == nil || d2 < melhor!.d2 {
                    melhor = (d2, r.km[i] + t * (r.km[i + 1] - r.km[i]), ri)
                }
            }
        }
        guard let m = melhor else { return nil }
        return (m.km, sqrt(m.d2) * Self.D2R * Self.R, m.r)
    }

    /** estacaDe do index.html, sem o "Est. " (o cartão escreve) */
    static func estaca(_ km: Double, _ refs: [(km: Double, e: Double, m: Double)]) -> String {
        var m = km * 1000
        if !refs.isEmpty {
            var ref: (km: Double, e: Double, m: Double)?
            for x in refs where x.km <= km + 1e-9 && (ref == nil || x.km > ref!.km) { ref = x }
            guard let r = ref else { return "" }
            m = (r.e * 20 + r.m) + (km - r.km) * 1000
        }
        guard m.isFinite, m >= 0 else { return "" }
        let est = Int(floor(m / 20))
        let resto = Int((m - Double(est) * 20).rounded())
        return resto >= 20 ? "\(est + 1)+0" : "\(est)+\(resto)"
    }
}

/** Liga, atualiza e desliga o cartão. Só iOS 18+: a extensão que desenha o cartão é do iOS 18 para cima. */
@available(iOS 18.0, *)
final class AtividadeKM {
    typealias Estado = KMAtividadeAtributos.ContentState

    let motor = MotorKM()
    private var atividade: Activity<KMAtividadeAtributos>?
    private var ultimoEstado: Estado?
    private var ultimoEnvio = Date.distantPast
    private var ultimoMovimento = Date()
    /** sentido de marcha pelo próprio KM, como no Modo Carro: só troca com variação > 5 m */
    private var anterior: (r: Int, km: Double)?
    private var sentido = 0
    private var dupla = false
    /** a pessoa arrastou o cartão para fora da tela: não volta até a próxima viagem (10 min parado) */
    private var recusada = false
    /** ligado pelo botão "Mostrar o cartão agora" (Ajustes): não sai sozinho com o carro parado — fica até a pessoa
     *  desligar a chave ou arrastar o cartão (ou o iOS encerrar, ~8 h). Serve para ver o KM parado e para testar. */
    private var manual = false

    /** o cartão está na tela? */
    var noAr: Bool { atividade?.activityState == .active }
    /** ainda segura um cartão (no ar, ou dispensado e não percebido): a próxima posicao() resolve qual */
    var temAtividade: Bool { atividade != nil }

    /** Liga o cartão (se ainda não estiver). Devolve "" se ligou/já estava, ou o motivo de não ligar. */
    func iniciar(_ p: CLLocation?, manual pedido: Bool) -> String {
        if let a = atividade {
            if a.activityState == .active { if pedido { manual = true }; return "" }
            /* dispensado pela pessoa (arrastou para o lado) ou encerrado pelo sistema: não insiste na mesma viagem */
            if a.activityState == .dismissed { recusada = true }
            atividade = nil
            manual = false
        }
        if pedido { recusada = false }   // o botão vale mesmo depois de a pessoa ter arrastado o cartão
        if recusada { return "recusada" }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return "desligada" }
        ultimoMovimento = Date()
        let e = p.map { estado($0) } ?? Estado(br: "", uf: "", km: 0, estaca: "", sentido: 0, dupla: false, fora: true)
        do {
            atividade = try Activity.request(attributes: KMAtividadeAtributos(),
                                             content: ActivityContent(state: e, staleDate: Date().addingTimeInterval(180)),
                                             pushType: nil)
            ultimoEstado = e
            ultimoEnvio = Date()
            manual = pedido
            return ""
        } catch {
            return "erro"
        }
    }

    /**
     * Nova leitura do GPS (com o app na frente ou no fundo). Devolve false quando o cartão acabou (10 min parado, se não
     * foi ligado pelo botão, ou dispensado) — aí o GpsNativo desliga o GPS de fundo para não gastar bateria.
     */
    func posicao(_ p: CLLocation) -> Bool {
        guard let a = atividade else { return false }
        if a.activityState != .active {
            if a.activityState == .dismissed { recusada = true }
            atividade = nil
            manual = false
            return false
        }
        let agora = Date()
        if p.speed >= 1.5 { ultimoMovimento = agora }   // ~5 km/h: abaixo disso é parado (ruído do GPS)
        if !manual && agora.timeIntervalSince(ultimoMovimento) > 600 {
            encerrar()
            recusada = false   // parou 10 min = fim da viagem: na próxima o cartão volta normalmente
            return false
        }
        let e = estado(p)
        /* poupa o sistema (e a bateria): no máximo 1 atualização a cada 2 s; mudança de situação (saiu da rodovia,
           pista dupla, sentido) vai na hora; parado, renova a cada 60 s só para o cartão não ficar "velho" */
        if let u = ultimoEstado {
            let urgente = u.fora != e.fora || u.dupla != e.dupla || u.sentido != e.sentido || u.br != e.br
            let passou = agora.timeIntervalSince(ultimoEnvio)
            if e == u && passou < 60 { return true }
            if !urgente && passou < 2 { return true }
        }
        ultimoEstado = e
        ultimoEnvio = agora
        let conteudo = ActivityContent(state: e, staleDate: agora.addingTimeInterval(180))
        Task { await a.update(conteudo) }
        return true
    }

    func encerrar() {
        guard let a = atividade else { return }
        atividade = nil
        ultimoEstado = nil
        manual = false
        Task { await a.end(nil, dismissalPolicy: .immediate) }
    }

    /** sobras de uma execução anterior do app (fechado à força com o cartão na tela): o KM ficou parado nelas */
    static func limpaSobras() {
        for a in Activity<KMAtividadeAtributos>.activities {
            Task { await a.end(nil, dismissalPolicy: .immediate) }
        }
    }

    /** app sendo fechado: encerra já (espera no máximo 1 s, senão o iOS mata o processo antes) */
    static func encerraTudoJa() {
        let fim = DispatchSemaphore(value: 0)
        Task.detached {
            for a in Activity<KMAtividadeAtributos>.activities { await a.end(nil, dismissalPolicy: .immediate) }
            fim.signal()
        }
        _ = fim.wait(timeout: .now() + 1)
    }

    private func estado(_ p: CLLocation) -> Estado {
        let la = p.coordinate.latitude, lo = p.coordinate.longitude
        guard let f = motor.acha(la, lo), f.dist <= motor.maxdist else {
            /* longe do eixo ou além do recorte enviado: mantém a última rodovia, marcada como fora */
            var e = ultimoEstado ?? Estado(br: "", uf: "", km: 0, estaca: "", sentido: 0, dupla: false, fora: true)
            e.fora = true
            e.dupla = false
            dupla = false
            return e
        }
        let r = motor.rodovias[f.r]
        if let ant = anterior, ant.r == f.r {
            if abs(f.km - ant.km) > 0.005 { sentido = f.km > ant.km ? 1 : -1; anterior = (f.r, f.km) }
        } else {
            anterior = (f.r, f.km)
            sentido = 0
        }
        /* mesmas margens do aviso da câmera (emPistaDupla): entra 50 m dentro do trecho, sai 100 m fora */
        let mg = dupla ? 0.1 : -0.05
        dupla = r.dup.contains { f.km >= $0[0] - mg && f.km <= $0[1] + mg }
        return Estado(br: r.br, uf: r.uf, km: f.km, estaca: MotorKM.estaca(f.km, r.refs), sentido: sentido,
                      dupla: dupla, fora: false)
    }
}
