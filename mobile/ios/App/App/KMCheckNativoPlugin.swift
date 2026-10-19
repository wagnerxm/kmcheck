import Foundation
import UIKit
import Photos
import CoreLocation
import CryptoKit
import Capacitor

/**
 * Partes nativas do KM Check no iPhone (a interface continua sendo o index.html do site).
 * Equivalente ao KMCheckNativoPlugin.java do Android: mesmo nome para o JS ("KMCheckNativo"), mesmos métodos e
 * mesmos parâmetros, para o index.html chamar NATIVO.chama('salvarImagem', …) sem saber em que sistema está.
 *
 * Diferenças do iPhone:
 *  - Fototeca: só a permissão "Adicionar fotos" (addOnly). Com ela não dá para criar/achar um álbum "KM Check"
 *    (isso exigiria acesso total à Fototeca, que a Apple só aceita se o app precisar LER as fotos — e não precisa).
 *    O nome original do arquivo (BR-116-SP_km-123...) vai junto e aparece no "Informações" da foto.
 *  - Arquivos (exportações): não existe "Downloads"; vão para Documentos/KM Check, visível no app Arquivos
 *    ("No Meu iPhone › KM Check") por causa do UIFileSharingEnabled no Info.plist.
 *  - Código do aparelho: identifierForVendor (IDFV). Diferente do ANDROID_ID, ele MUDA se a pessoa apagar todos
 *    os apps do mesmo desenvolvedor e instalar de novo — no painel o mesmo iPhone pode virar 2 aparelhos nesse caso.
 *    Não é o IDFA (de anúncios): não precisa de App Tracking Transparency.
 *  - Nada aqui lê datas de arquivo, espaço em disco nem tempo de boot (APIs que a Apple obriga a justificar no
 *    PrivacyInfo.xcprivacy). A limpeza da pasta temporária apaga a pasta inteira, sem olhar datas.
 */
@objc(KMCheckNativoPlugin)
public class KMCheckNativoPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KMCheckNativoPlugin"
    public let jsName = "KMCheckNativo"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "salvarImagem", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "salvarArquivo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "compartilhar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "compartilharPreparar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "compartilharVarios", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "telaAcesa", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "idAparelho", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "localizacao", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "abrirAjustesLocalizacao", returnType: CAPPluginReturnPromise),
        /* só no iPhone (o index.html chama só quando NATIVO.ios): */
        CAPPluginMethod(name: "infoAparelho", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "vibrar", returnType: CAPPluginReturnPromise),
        /* GPS nativo: o index.html troca o navigator.geolocation por estes no iPhone (ver GpsNativo abaixo) */
        CAPPluginMethod(name: "gpsVigiar", returnType: CAPPluginReturnCallback),
        CAPPluginMethod(name: "gpsParar", returnType: CAPPluginReturnPromise)
    ]

    private lazy var gps = GpsNativo(plugin: self)

    /** Começa a mandar posições para o index.html (mesmo formato do navigator.geolocation). Chamada viva. */
    @objc func gpsVigiar(_ call: CAPPluginCall) {
        call.keepAlive = true
        DispatchQueue.main.async { self.gps.vigiar(call) }
    }

    @objc func gpsParar(_ call: CAPPluginCall) {
        let id = call.getString("id", "")
        DispatchQueue.main.async {
            self.gps.parar(id)
            call.resolve()
        }
    }

    fileprivate func solta(_ call: CAPPluginCall) { bridge?.releaseCall(call) }

    private static let pasta = "KM Check"
    private static let semFotos = "Sem permissão para salvar no Fotos. Ajustes › Apps › KM Check › Fotos › Adicionar Fotos."

    /** o pedido de "tela acesa" do JS; reaplicado quando o app volta para a frente */
    private var querTelaAcesa = false
    /** só para ler o estado da permissão de localização (as posições vêm do GpsNativo, no fim deste arquivo) */
    private var gerenteLocal: CLLocationManager?

    @objc override public func load() {
        /* o iOS pode desligar o isIdleTimerDisabled quando o app sai da frente; ao voltar, liga de novo */
        NotificationCenter.default.addObserver(self, selector: #selector(voltouParaFrente),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func voltouParaFrente() {
        if querTelaAcesa { UIApplication.shared.isIdleTimerDisabled = true }
    }

    // MARK: - Fotos

    /** Grava uma imagem (base64) no app Fotos. Devolve { uri } (o localIdentifier da foto). */
    @objc func salvarImagem(_ call: CAPPluginCall) {
        guard let dados = decodifica(call) else { return }
        let nome = nomeSeguro(call.getString("nome", "km-check.jpg"))
        let grava = {
            let criada = Caixa()
            PHPhotoLibrary.shared().performChanges({
                let pedido = PHAssetCreationRequest.forAsset()
                let opcoes = PHAssetResourceCreationOptions()
                opcoes.originalFilename = nome
                pedido.addResource(with: .photo, data: dados, options: opcoes)
                criada.valor = pedido.placeholderForCreatedAsset?.localIdentifier
            }, completionHandler: { ok, erro in
                if ok { call.resolve(["uri": criada.valor ?? ""]) }
                else { call.reject("Não consegui salvar a imagem: " + (erro?.localizedDescription ?? "erro desconhecido")) }
            })
        }
        switch PHPhotoLibrary.authorizationStatus(for: .addOnly) {
        case .authorized, .limited:
            grava()
        case .notDetermined:
            /* 1ª foto: o iOS mostra o pedido com o NSPhotoLibraryAddUsageDescription */
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { estado in
                if estado == .authorized || estado == .limited { grava() } else { call.reject(Self.semFotos) }
            }
        default:
            /* negada/restrita: o index.html cai no Compartilhar (galeria do app) ou avisa */
            call.reject(Self.semFotos)
        }
    }

    // MARK: - Arquivos

    /** Grava um arquivo qualquer (exportações, zip) em Documentos/KM Check. Devolve { uri }. */
    @objc func salvarArquivo(_ call: CAPPluginCall) {
        guard let dados = decodifica(call) else { return }
        let nome = nomeSeguro(call.getString("nome", "km-check.bin"))
        do {
            let fm = FileManager.default
            let docs = try fm.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            let dir = docs.appendingPathComponent(Self.pasta, isDirectory: true)
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            let destino = nomeLivre(dir.appendingPathComponent(nome))
            try dados.write(to: destino, options: .atomic)
            call.resolve(["uri": destino.absoluteString])
        } catch {
            call.reject("Não consegui salvar o arquivo: " + error.localizedDescription)
        }
    }

    // MARK: - Compartilhar

    /**
     * Abre o "Compartilhar" do iOS com um arquivo (base64). Resolve quando a folha fecha:
     * { concluido: true/false, destino: "com.apple.UIKit.activity.SaveToCameraRoll" | "net.whatsapp…" | "" }.
     * Cancelar NÃO é erro (resolve com concluido=false), igual ao Android, que resolve ao abrir o seletor.
     * O parâmetro "titulo" do Android não tem equivalente na folha do iOS e é ignorado.
     */
    @objc func compartilhar(_ call: CAPPluginCall) {
        guard let dados = decodifica(call) else { return }
        let nome = nomeSeguro(call.getString("nome", "km-check.jpg"))
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent("compartilhar", isDirectory: true)
        let arquivo = dir.appendingPathComponent(nome)
        do {
            /* o que sobrou do compartilhamento anterior sai inteiro (sem ler datas de arquivo) */
            try? fm.removeItem(at: dir)
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            try dados.write(to: arquivo, options: .atomic)
        } catch {
            call.reject("Não consegui compartilhar: " + error.localizedDescription)
            return
        }
        abreFolha(call, [arquivo])
    }

    /**
     * Várias fotos de uma vez (seleção na galeria do app), em duas etapas para não passar todas pela ponte
     * JS↔nativo numa chamada só (dezenas de MB em base64): compartilharPreparar grava UMA foto por chamada
     * (primeiro=true limpa as da vez anterior) e compartilharVarios abre a folha com todas. Resolve como o
     * compartilhar: { concluido, destino }.
     */
    private static let pastaVarios = "compartilhar-varios"

    @objc func compartilharPreparar(_ call: CAPPluginCall) {
        guard let dados = decodifica(call) else { return }
        let nome = nomeSeguro(call.getString("nome", "km-check.jpg"))
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent(Self.pastaVarios, isDirectory: true)
        do {
            if call.getBool("primeiro", false) { try? fm.removeItem(at: dir) }
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            try dados.write(to: dir.appendingPathComponent(nome), options: .atomic)
            call.resolve()
        } catch {
            call.reject("Não consegui preparar a foto: " + error.localizedDescription)
        }
    }

    @objc func compartilharVarios(_ call: CAPPluginCall) {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent(Self.pastaVarios, isDirectory: true)
        let fotos = ((try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [])
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        if fotos.isEmpty { call.reject("Nenhuma foto preparada."); return }
        abreFolha(call, fotos)
    }

    /** a folha "Compartilhar" do iOS com os arquivos; resolve quando ela fecha */
    private func abreFolha(_ call: CAPPluginCall, _ itens: [URL]) {
        DispatchQueue.main.async { [weak self] in
            guard let base = self?.bridge?.viewController else { call.reject("Não consegui compartilhar."); return }
            let folha = UIActivityViewController(activityItems: itens, applicationActivities: nil)
            /* iPad (e iPhone rodando em iPad): a folha é um popover e precisa de âncora, senão o app fecha */
            if let pop = folha.popoverPresentationController {
                pop.sourceView = base.view
                pop.sourceRect = CGRect(x: base.view.bounds.midX, y: base.view.bounds.maxY - 80, width: 1, height: 1)
                pop.permittedArrowDirections = []
            }
            folha.completionWithItemsHandler = { tipo, concluido, _, erro in
                if let erro = erro { call.reject("Não consegui compartilhar: " + erro.localizedDescription); return }
                call.resolve(["concluido": concluido, "destino": tipo?.rawValue ?? ""])
            }
            var topo: UIViewController = base
            while let porCima = topo.presentedViewController, !porCima.isBeingDismissed { topo = porCima }
            topo.present(folha, animated: true)
        }
    }

    // MARK: - Tela acesa

    /** Mantém a tela acesa enquanto o app está aberto (acompanhar o KM dirigindo). { ligar: true/false } */
    @objc func telaAcesa(_ call: CAPPluginCall) {
        let ligar = call.getBool("ligar", true)
        DispatchQueue.main.async {
            self.querTelaAcesa = ligar
            UIApplication.shared.isIdleTimerDisabled = ligar
            call.resolve()
        }
    }

    // MARK: - Identificação (só com a autorização de uso, pedida na 1ª abertura)

    /**
     * Código anônimo do aparelho para a contagem do painel: SHA-256("kmcheck:" + identifierForVendor), 16 bytes em
     * hexa, prefixo "ios-" (no Android é "and-" com o ANDROID_ID). Não dá para voltar ao IDFV a partir dele.
     * Uso só para estatística, nunca para anúncio nem para cruzar com dados de outras empresas. Devolve { id }.
     */
    @objc func idAparelho(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let bruto = UIDevice.current.identifierForVendor?.uuidString, !bruto.isEmpty else {
                call.reject("indisponível")   // acontece logo depois de ligar o iPhone, antes do 1º desbloqueio
                return
            }
            let hash = SHA256.hash(data: Data(("kmcheck:" + bruto).utf8))
            let hexa = hash.prefix(16).map { String(format: "%02x", $0) }.joined()
            call.resolve(["id": "ios-" + hexa])
        }
    }

    /**
     * Modelo e sistema direto do iOS ("iPhone16,1", "iOS 18.1"). Substitui, no app da loja, a adivinhação do
     * modelo pelo benchmark de CPU + WebGL + 120 Hz + câmeras do index.html, que a Apple pode ver como
     * fingerprinting (proibido mesmo sem rastreamento). Devolve { modelo, sistema }.
     */
    @objc func infoAparelho(_ call: CAPPluginCall) {
        var modelo = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] ?? ""
        if modelo.isEmpty {
            var u = utsname()
            uname(&u)
            modelo = withUnsafeBytes(of: &u.machine) { bytes in
                String(decoding: bytes.prefix(while: { $0 != 0 }), as: UTF8.self)
            }
        }
        DispatchQueue.main.async {
            call.resolve(["modelo": modelo, "sistema": "iOS " + UIDevice.current.systemVersion])
        }
    }

    // MARK: - Localização

    /**
     * A Localização do iPhone está ligada? Devolve { ligada, permissao, exata }:
     *  - ligada: Ajustes › Privacidade e Segurança › Serviços de Localização
     *  - permissao: "perguntar" | "negada" | "restrita" | "permitida"
     *  - exata: false quando a pessoa desligou "Localização Exata" (o GPS vem com ±1–3 km)
     */
    @objc func localizacao(_ call: CAPPluginCall) {
        /* locationServicesEnabled() não pode rodar na linha principal (a Apple avisa que trava a interface) */
        DispatchQueue.global(qos: .userInitiated).async {
            let ligada = CLLocationManager.locationServicesEnabled()
            DispatchQueue.main.async {
                if self.gerenteLocal == nil { self.gerenteLocal = CLLocationManager() }
                guard let gm = self.gerenteLocal else { call.resolve(["ligada": ligada]); return }
                let permissao: String
                switch gm.authorizationStatus {
                case .notDetermined: permissao = "perguntar"
                case .denied: permissao = "negada"
                case .restricted: permissao = "restrita"
                default: permissao = "permitida"
                }
                call.resolve(["ligada": ligada, "permissao": permissao, "exata": gm.accuracyAuthorization == .fullAccuracy])
            }
        }
    }

    /**
     * Abre os Ajustes do iOS na página do KM Check (Localização, Câmera, Fotos). O iOS não deixa um app abrir
     * direto a tela geral de "Serviços de Localização" (o atalho "App-Prefs:" é API privada e dá rejeição).
     */
    @objc func abrirAjustesLocalizacao(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else {
                call.reject("Não consegui abrir os ajustes.")
                return
            }
            UIApplication.shared.open(url, options: [:]) { ok in
                if ok { call.resolve() } else { call.reject("Não consegui abrir os ajustes.") }
            }
        }
    }

    // MARK: - Vibração

    /** O iPhone não tem navigator.vibrate: a "batida" do obturador vem daqui. { forte: true/false } */
    @objc func vibrar(_ call: CAPPluginCall) {
        let forte = call.getBool("forte", false)
        DispatchQueue.main.async {
            let gerador = UIImpactFeedbackGenerator(style: forte ? .heavy : .medium)
            gerador.prepare()
            gerador.impactOccurred()
            call.resolve()
        }
    }

    // MARK: - Utilidades

    private func decodifica(_ call: CAPPluginCall) -> Data? {
        guard var b64 = call.getString("base64"), !b64.isEmpty else {
            call.reject("Arquivo vazio.")
            return nil
        }
        if b64.hasPrefix("data:"), let virgula = b64.firstIndex(of: ",") {
            b64 = String(b64[b64.index(after: virgula)...])
        }
        guard let dados = Data(base64Encoded: b64, options: .ignoreUnknownCharacters), !dados.isEmpty else {
            call.reject("Arquivo inválido.")
            return nil
        }
        return dados
    }

    /** nome de arquivo sem barras (que virariam subpasta) e sem ":" (que o Arquivos mostra como "/") */
    private func nomeSeguro(_ nome: String) -> String {
        let limpo = nome.replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return limpo.isEmpty ? "km-check" : limpo
    }

    /** se já existe, acrescenta " (1)", " (2)"… como o Android faz no MediaStore */
    private func nomeLivre(_ url: URL) -> URL {
        let fm = FileManager.default
        if !fm.fileExists(atPath: url.path) { return url }
        let dir = url.deletingLastPathComponent()
        let ext = url.pathExtension
        let base = url.deletingPathExtension().lastPathComponent
        var n = 1
        while true {
            let nome = base + " (\(n))" + (ext.isEmpty ? "" : "." + ext)
            let candidato = dir.appendingPathComponent(nome)
            if !fm.fileExists(atPath: candidato.path) { return candidato }
            n += 1
        }
    }
}

/**
 * GPS pelo CoreLocation. O navigator.geolocation do WKWebView pede a permissão DUAS vezes (a do iOS e, a cada
 * abertura do app, outra "“localhost” quer usar sua localização") — a Apple reprova e o usuário estranha.
 * Daqui sai uma posição por leitura para cada "vigia" aberta pelo index.html, no formato do navegador; erros vão
 * como { erro: 1 } (permissão negada) ou { erro: 2 } (sem sinal) sem encerrar a vigia, para voltar a funcionar
 * sozinho quando a pessoa libera nos Ajustes.
 */
private final class GpsNativo: NSObject, CLLocationManagerDelegate {
    private weak var plugin: KMCheckNativoPlugin?
    private var gerente: CLLocationManager?
    private var vigias: [String: CAPPluginCall] = [:]

    init(plugin: KMCheckNativoPlugin) {
        self.plugin = plugin
        super.init()
    }

    func vigiar(_ call: CAPPluginCall) {
        vigias[call.callbackId] = call
        let g = gerente ?? {
            let novo = CLLocationManager()
            novo.delegate = self
            novo.desiredAccuracy = kCLLocationAccuracyBestForNavigation
            novo.distanceFilter = kCLDistanceFilterNone
            novo.activityType = .automotiveNavigation
            novo.pausesLocationUpdatesAutomatically = false
            gerente = novo
            return novo
        }()
        aplica(g)
    }

    func parar(_ id: String) {
        if let v = vigias.removeValue(forKey: id) { plugin?.solta(v) }
        if vigias.isEmpty { gerente?.stopUpdatingLocation() }
    }

    private func aplica(_ g: CLLocationManager) {
        switch g.authorizationStatus {
        case .notDetermined: g.requestWhenInUseAuthorization()   // o iOS mostra o pedido com o NSLocationWhenInUseUsageDescription
        case .denied, .restricted: avisa(1, "Sem permissão de localização.")
        default: g.startUpdatingLocation()
        }
    }

    func locationManagerDidChangeAuthorization(_ g: CLLocationManager) {
        if !vigias.isEmpty { aplica(g) }
    }

    func locationManager(_ g: CLLocationManager, didUpdateLocations locais: [CLLocation]) {
        guard let p = locais.last, p.horizontalAccuracy >= 0 else { return }
        /* valores negativos = "não disponível" no CoreLocation; no navegador viriam como null */
        let r: [String: Any] = [
            "lat": p.coordinate.latitude, "lon": p.coordinate.longitude, "acc": p.horizontalAccuracy,
            "alt": p.verticalAccuracy >= 0 ? p.altitude : NSNull(),
            "altAcc": p.verticalAccuracy >= 0 ? p.verticalAccuracy : NSNull(),
            "spd": p.speed >= 0 ? p.speed : NSNull(),
            "head": p.course >= 0 ? p.course : NSNull(),
            "ts": p.timestamp.timeIntervalSince1970 * 1000
        ]
        for v in vigias.values { v.resolve(r) }
    }

    func locationManager(_ g: CLLocationManager, didFailWithError erro: Error) {
        let codigo = (erro as? CLError)?.code
        if codigo == .locationUnknown { return }   // temporário: o GPS continua tentando sozinho
        if codigo == .denied { avisa(1, "Sem permissão de localização.") } else { avisa(2, erro.localizedDescription) }
    }

    private func avisa(_ codigo: Int, _ msg: String) {
        for v in vigias.values { v.resolve(["erro": codigo, "msg": msg]) }
    }
}

/** guarda o identificador da foto criada dentro do bloco do PHPhotoLibrary (que roda em outra fila) */
private final class Caixa {
    var valor: String?
}
