package br.com.kmcheck.app;

import android.app.AlertDialog;
import android.graphics.Bitmap;
import android.webkit.JsResult;
import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        /* plugin próprio do KM Check (galeria, downloads, compartilhar, tela acesa): registra antes do super */
        registerPlugin(KMCheckNativoPlugin.class);
        super.onCreate(savedInstanceState);

        /* Letra do sistema em 130–200%: o WebView aumentava todo o texto do app (o CSS é em px) e a barra da
           câmera, a placa de KM e o Modo Carro estouravam. 100% = o mesmo tamanho do app no iPhone e no navegador.
           Quem precisa de letra maior tem o zoom do sistema e os tamanhos de legenda do próprio app. */
        if (getBridge() != null && getBridge().getWebView() != null) getBridge().getWebView().getSettings().setTextZoom(100);

        /* Câmera: enquanto o vídeo não tem imagem (abrindo, pedindo permissão), o WebView do Android desenha a
           "capa" padrão dele — um ícone de play gigante cinza. Aqui a capa padrão vira um pixel transparente.
           Mantém o cliente do Capacitor (permissões de câmera/GPS, seletor de arquivos), só troca a capa. */
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
                @Override
                public Bitmap getDefaultVideoPoster() {
                    return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
                }

                /* confirm() (excluir foto, rodovia, contrato…): o do Capacitor tem "OK"/"Cancel" fixos em inglês */
                @Override
                public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                    if (isFinishing()) { result.cancel(); return true; }
                    new AlertDialog.Builder(view.getContext())
                        .setMessage(message)
                        .setPositiveButton("Confirmar", (d, w) -> result.confirm())
                        .setNegativeButton("Cancelar", (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                    return true;
                }

                @Override
                public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                    if (isFinishing()) { result.confirm(); return true; }
                    new AlertDialog.Builder(view.getContext())
                        .setMessage(message)
                        .setPositiveButton("OK", (d, w) -> result.confirm())
                        .setOnCancelListener(d -> result.confirm())
                        .show();
                    return true;
                }
            });
        }

        /* Botão/gesto "voltar": o app (index.html) deixa uma entrada no histórico sempre que algo está
           aberto por cima da tela inicial (outra tela, câmera, Modo Carro, galeria, manual…). Aqui o
           "voltar" vai para essa entrada, e a página fecha só o que está por cima. Sem nada aberto,
           sai do app como qualquer outro (sem isto o Android fechava o app de qualquer tela). */
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView wv = getBridge() != null ? getBridge().getWebView() : null;
                if (wv != null && wv.canGoBack()) {
                    wv.goBack();
                } else {
                    /* desliga só para repassar ao sistema e religa em seguida: no Android 12+ o app vai para o fundo
                       (não fecha) e, ao voltar, o callback desligado fazia o "voltar" sair do app de qualquer tela */
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    setEnabled(true);
                }
            }
        });
    }
}
