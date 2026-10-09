package br.com.kmcheck.app;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        /* plugin próprio do KM Check (galeria, downloads, compartilhar, tela acesa): registra antes do super */
        registerPlugin(KMCheckNativoPlugin.class);
        super.onCreate(savedInstanceState);

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
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });
    }
}
