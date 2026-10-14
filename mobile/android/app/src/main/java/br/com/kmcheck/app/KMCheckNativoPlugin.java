package br.com.kmcheck.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.location.LocationManager;
import android.provider.Settings;
import androidx.core.location.LocationManagerCompat;
import android.content.Intent;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.WindowManager;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Partes nativas do KM Check no Android (a interface continua sendo o index.html do site).
 *
 * No navegador o app salva a foto com truques do Chrome (service worker + download) que não existem
 * dentro de um app nativo; aqui a gravação vai direto para a galeria pelo MediaStore, na pasta
 * "Pictures/KM Check", sem pedir permissão de armazenamento no Android 10+ (só até o Android 9).
 */
@CapacitorPlugin(
    name = "KMCheckNativo",
    permissions = { @Permission(alias = "galeria", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }) }
)
public class KMCheckNativoPlugin extends Plugin {

    private static final String PASTA = "KM Check";

    /** Do Android 7 ao 9 gravar na pasta pública exige a permissão de armazenamento, pedida na hora. Antes ela
        só estava declarada no manifesto e nunca era pedida: nesses aparelhos nenhuma foto chegava à galeria. */
    private boolean precisaPermissao(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q || getPermissionState("galeria") == PermissionState.GRANTED) return false;
        requestPermissionForAlias("galeria", call, "galeriaRespondida");
        return true;
    }

    @PermissionCallback
    private void galeriaRespondida(PluginCall call) {
        if (getPermissionState("galeria") != PermissionState.GRANTED) { call.reject("Sem permissão para gravar na galeria."); return; }
        if ("salvarArquivo".equals(call.getMethodName())) gravaArquivo(call); else gravaImagem(call);
    }

    /** Grava uma imagem (base64) na galeria do celular. Devolve { uri }. */
    @PluginMethod
    public void salvarImagem(PluginCall call) {
        if (!precisaPermissao(call)) gravaImagem(call);
    }

    /** O nome vem do JS e vira caminho de arquivo: tira barras, ".." e caracteres que o Android/FAT recusam.
        Sem isto um nome como "../shared_prefs/x" gravaria fora da pasta (no Android 9 ou no cache do app). */
    private static String nomeSeguro(String nome, String padrao) {
        if (nome == null) return padrao;
        String n = nome.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]", "_").replaceAll("^[.\\s]+", "").trim();
        if (n.isEmpty()) return padrao;
        return n.length() > 120 ? n.substring(n.length() - 120) : n;   // corta o começo: preserva a extensão
    }

    /** Android 9 ou anterior: File na pasta pública SOBRESCREVIA uma foto de mesmo nome (o MediaStore do 10+ já
        acrescenta " (1)"). Aqui faz o mesmo: "nome (1).jpg", "nome (2).jpg"… */
    private static File arquivoLivre(File dir, String nome) {
        File f = new File(dir, nome);
        if (!f.exists()) return f;
        int ponto = nome.lastIndexOf('.');
        String base = ponto > 0 ? nome.substring(0, ponto) : nome, ext = ponto > 0 ? nome.substring(ponto) : "";
        for (int i = 1; i < 1000; i++) { f = new File(dir, base + " (" + i + ")" + ext); if (!f.exists()) return f; }
        return f;
    }

    private void gravaImagem(PluginCall call) {
        String nome = nomeSeguro(call.getString("nome"), "km-check.jpg");
        String mime = call.getString("mime", "image/jpeg");
        byte[] dados = decodifica(call);
        if (dados == null) return;
        Uri pendente = null;
        ContentResolver cr = getContext().getContentResolver();
        try {
            Uri uri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Images.Media.DISPLAY_NAME, nome);
                v.put(MediaStore.Images.Media.MIME_TYPE, mime);
                v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + PASTA);
                v.put(MediaStore.Images.Media.DATE_TAKEN, System.currentTimeMillis());
                v.put(MediaStore.Images.Media.IS_PENDING, 1);
                uri = cr.insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
                if (uri == null) throw new Exception("galeria indisponível");
                pendente = uri;   // se a escrita falhar, a linha "pendente" é apagada (senão vira lixo e o próximo nome ganha " (1)")
                try (OutputStream os = cr.openOutputStream(uri)) { os.write(dados); }
                v.clear();
                v.put(MediaStore.Images.Media.IS_PENDING, 0);
                cr.update(uri, v, null, null);
                pendente = null;
            } else {
                /* Android 9 ou anterior: arquivo na pasta pública + aviso ao índice de mídia */
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), PASTA);
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("não consegui criar a pasta");
                File f = arquivoLivre(dir, nome);
                try (FileOutputStream os = new FileOutputStream(f)) { os.write(dados); }
                MediaScannerConnection.scanFile(getContext(), new String[]{f.getAbsolutePath()}, new String[]{mime}, null);
                uri = Uri.fromFile(f);
            }
            JSObject r = new JSObject();
            r.put("uri", uri.toString());
            call.resolve(r);
        } catch (Throwable e) {   // Throwable: inclui falta de memória, que derrubava o app
            if (pendente != null) try { cr.delete(pendente, null, null); } catch (Throwable ignora) {}
            call.reject("Não consegui salvar a imagem: " + e.getMessage());
        }
    }

    /** Grava um arquivo qualquer (exportações, zip) em Downloads/KM Check. Devolve { uri }. */
    @PluginMethod
    public void salvarArquivo(PluginCall call) {
        if (!precisaPermissao(call)) gravaArquivo(call);
    }

    private void gravaArquivo(PluginCall call) {
        String nome = nomeSeguro(call.getString("nome"), "km-check.bin");
        String mime = call.getString("mime", "application/octet-stream");
        byte[] dados = decodifica(call);
        if (dados == null) return;
        Uri pendente = null;
        ContentResolver cr = getContext().getContentResolver();
        try {
            Uri uri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, nome);
                v.put(MediaStore.Downloads.MIME_TYPE, mime);
                v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + PASTA);
                v.put(MediaStore.Downloads.IS_PENDING, 1);
                uri = cr.insert(MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
                if (uri == null) throw new Exception("Downloads indisponível");
                pendente = uri;   // como na foto: se a escrita falhar, apaga a linha "pendente" (senão fica um arquivo fantasma em Downloads)
                try (OutputStream os = cr.openOutputStream(uri)) { os.write(dados); }
                v.clear();
                v.put(MediaStore.Downloads.IS_PENDING, 0);
                cr.update(uri, v, null, null);
                pendente = null;
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), PASTA);
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("não consegui criar a pasta");
                File f = arquivoLivre(dir, nome);
                try (FileOutputStream os = new FileOutputStream(f)) { os.write(dados); }
                uri = Uri.fromFile(f);
            }
            JSObject r = new JSObject();
            r.put("uri", uri.toString());
            call.resolve(r);
        } catch (Throwable e) {
            if (pendente != null) try { cr.delete(pendente, null, null); } catch (Throwable ignora) {}
            call.reject("Não consegui salvar o arquivo: " + e.getMessage());
        }
    }

    /** Abre o "Compartilhar" do Android com um arquivo (base64). */
    @PluginMethod
    public void compartilhar(PluginCall call) {
        String nome = nomeSeguro(call.getString("nome"), "km-check.jpg");
        String mime = call.getString("mime", "image/jpeg");
        String titulo = call.getString("titulo", "Compartilhar");
        byte[] dados = decodifica(call);
        if (dados == null) return;
        try {
            /* arquivo temporário no cache do app, liberado só para quem recebe (FileProvider) */
            File dir = new File(getContext().getCacheDir(), "compartilhar");
            if (!dir.exists()) dir.mkdirs();
            File[] velhos = dir.listFiles();
            if (velhos != null) for (File v : velhos) if (System.currentTimeMillis() - v.lastModified() > 3600_000L) v.delete();
            File f = new File(dir, nome);
            try (FileOutputStream os = new FileOutputStream(f)) { os.write(dados); }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent envio = new Intent(Intent.ACTION_SEND);
            envio.setType(mime);
            envio.putExtra(Intent.EXTRA_STREAM, uri);
            envio.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent escolha = Intent.createChooser(envio, titulo);
            escolha.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(escolha);
            call.resolve();
        } catch (Throwable e) {
            call.reject("Não consegui compartilhar: " + e.getMessage());
        }
    }

    /** Mantém a tela acesa enquanto o app está aberto (acompanhar o KM dirigindo). */
    @PluginMethod
    public void telaAcesa(PluginCall call) {
        boolean ligar = Boolean.TRUE.equals(call.getBoolean("ligar", true));
        getActivity().runOnUiThread(() -> {
            if (ligar) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    /**
     * Identificação anônima do aparelho para a contagem de usuários do painel. Usa o ANDROID_ID, que o
     * Android gera por app + aparelho e que NÃO muda se a pessoa desinstalar e instalar de novo (ao contrário
     * do código guardado pelo app, que se perde). Vai embaralhado (SHA-256), então não dá para chegar ao
     * ANDROID_ID a partir dele. Uso só para estatística, nunca para anúncio. Devolve { id }.
     */
    @PluginMethod
    public void idAparelho(PluginCall call) {
        try {
            String bruto = android.provider.Settings.Secure.getString(getContext().getContentResolver(), android.provider.Settings.Secure.ANDROID_ID);
            if (bruto == null || bruto.isEmpty()) { call.reject("indisponível"); return; }
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
            byte[] h = md.digest(("kmcheck:" + bruto).getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder("and-");
            for (int i = 0; i < 16; i++) sb.append(String.format("%02x", h[i]));
            JSObject r = new JSObject();
            r.put("id", sb.toString());
            call.resolve(r);
        } catch (Exception e) {
            call.reject("indisponível");
        }
    }

    /** A Localização do celular está ligada? O WebView não mostra o "Ativar localização" do sistema como o
        Chrome: com ela desligada o GPS só ficava mudo. Devolve { ligada }. */
    @PluginMethod
    public void localizacao(PluginCall call) {
        LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        JSObject r = new JSObject();
        r.put("ligada", lm != null && LocationManagerCompat.isLocationEnabled(lm));
        call.resolve(r);
    }

    /** Abre a tela de Localização do Android para a pessoa ligar. */
    @PluginMethod
    public void abrirAjustesLocalizacao(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);
            call.resolve();
        } catch (Throwable e) {
            call.reject("Não consegui abrir os ajustes.");
        }
    }

    private byte[] decodifica(PluginCall call) {
        String b64 = call.getString("base64");
        if (b64 == null || b64.isEmpty()) { call.reject("Arquivo vazio."); return null; }
        int virgula = b64.indexOf(',');
        if (b64.startsWith("data:") && virgula > 0) b64 = b64.substring(virgula + 1);
        try { return Base64.decode(b64, Base64.DEFAULT); }
        catch (IllegalArgumentException e) { call.reject("Arquivo inválido."); return null; }
        catch (OutOfMemoryError e) { call.reject("Pouca memória para salvar a foto."); return null; }
    }
}
