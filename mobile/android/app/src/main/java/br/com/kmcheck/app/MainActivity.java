package br.com.kmcheck.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        /* plugin próprio do KM Check (galeria, downloads, compartilhar, tela acesa): registra antes do super */
        registerPlugin(KMCheckNativoPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
