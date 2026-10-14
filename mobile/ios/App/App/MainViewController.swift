import UIKit
import WebKit
import Capacitor

/**
 * Tela principal do app no iPhone: a mesma do Capacitor (CAPBridgeViewController) com dois acréscimos,
 * equivalentes ao MainActivity.java do Android:
 *  1. registra o plugin próprio KMCheckNativo (galeria, compartilhar, tela acesa, código do aparelho, GPS);
 *  2. confirm()/alert() em português — o Capacitor 8.5.3 mostra "Cancel"/"Ok" fixos em inglês
 *     ("Excluir esta foto?" com botão "Cancel" ficava estranho).
 * Ligada pelo SceneDelegate.swift (rootViewController = MainViewController()).
 */
class MainViewController: CAPBridgeViewController {
    /* o uiDelegate do WKWebView é "weak": quem segura o delegado em português é esta tela */
    private var avisos: AvisosEmPortugues?

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(KMCheckNativoPlugin())

        if let wv = webView, let original = wv.uiDelegate {
            let delegado = AvisosEmPortugues(original: original)
            delegado.tela = self
            avisos = delegado
            wv.uiDelegate = delegado
        }
        /* deslizar da borda não deve "voltar página" (o app é uma página só; o voltar é do próprio app) */
        webView?.allowsBackForwardNavigationGestures = false
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        /* fundo escuro (o mesmo do app) atrás do WebView: sem o "piscar" branco ao abrir */
        let fundo = UIColor(red: 10 / 255, green: 12 / 255, blue: 14 / 255, alpha: 1)
        view.backgroundColor = fundo
        webView?.isOpaque = false
        webView?.backgroundColor = fundo
        webView?.scrollView.backgroundColor = fundo
        /* o app rola por dentro (o <main>); a página inteira "elástica" arrastava o cabeçalho e o menu junto */
        webView?.scrollView.bounces = false
        /* toque longo não abre a prévia de link do iOS (no app parecia travamento) */
        webView?.allowsLinkPreview = false
    }
}

/**
 * Delegado de interface do WebView que só troca alert() e confirm() por versões em português e repassa TODO o
 * resto ao delegado original do Capacitor (permissão de câmera e de movimento, prompt() usado pela ponte
 * JS↔nativo, abrir links). O repasse é pelo mecanismo do Objective-C (responds/forwardingTarget), então
 * nada do Capacitor deixa de funcionar mesmo que versões futuras acrescentem métodos.
 */
final class AvisosEmPortugues: NSObject, WKUIDelegate {
    private let original: WKUIDelegate
    weak var tela: UIViewController?

    init(original: WKUIDelegate) {
        self.original = original
        super.init()
    }

    override func responds(to aSelector: Selector!) -> Bool {
        return super.responds(to: aSelector) || original.responds(to: aSelector)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        if !super.responds(to: aSelector) && original.responds(to: aSelector) { return original }
        return super.forwardingTarget(for: aSelector)
    }

    private func topo() -> UIViewController? {
        guard var vc = tela else { return nil }
        while let porCima = vc.presentedViewController, !porCima.isBeingDismissed { vc = porCima }
        return vc
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard let vc = topo() else { completionHandler(); return }
        let alerta = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alerta.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        vc.present(alerta, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard let vc = topo() else { completionHandler(false); return }
        let alerta = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alerta.addAction(UIAlertAction(title: "Cancelar", style: .cancel) { _ in completionHandler(false) })
        alerta.addAction(UIAlertAction(title: "Confirmar", style: .default) { _ in completionHandler(true) })
        vc.present(alerta, animated: true)
    }
}
