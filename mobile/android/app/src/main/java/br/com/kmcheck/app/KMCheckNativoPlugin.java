package br.com.kmcheck.app;

import android.content.ContentResolver;
import android.content.ContentValues;
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
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

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
@CapacitorPlugin(name = "KMCheckNativo")
public class KMCheckNativoPlugin extends Plugin {

    private static final String PASTA = "KM Check";

    /** Grava uma imagem (base64) na galeria do celular. Devolve { uri }. */
    @PluginMethod
    public void salvarImagem(PluginCall call) {
        String nome = call.getString("nome", "km-check.jpg");
        String mime = call.getString("mime", "image/jpeg");
        byte[] dados = decodifica(call);
        if (dados == null) return;
        try {
            Uri uri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Images.Media.DISPLAY_NAME, nome);
                v.put(MediaStore.Images.Media.MIME_TYPE, mime);
                v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + PASTA);
                v.put(MediaStore.Images.Media.IS_PENDING, 1);
                ContentResolver cr = getContext().getContentResolver();
                uri = cr.insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
                if (uri == null) throw new Exception("galeria indisponível");
                try (OutputStream os = cr.openOutputStream(uri)) { os.write(dados); }
                v.clear();
                v.put(MediaStore.Images.Media.IS_PENDING, 0);
                cr.update(uri, v, null, null);
            } else {
                /* Android 9 ou anterior: arquivo na pasta pública + aviso ao índice de mídia */
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), PASTA);
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("não consegui criar a pasta");
                File f = new File(dir, nome);
                try (FileOutputStream os = new FileOutputStream(f)) { os.write(dados); }
                MediaScannerConnection.scanFile(getContext(), new String[]{f.getAbsolutePath()}, new String[]{mime}, null);
                uri = Uri.fromFile(f);
            }
            JSObject r = new JSObject();
            r.put("uri", uri.toString());
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Não consegui salvar a imagem: " + e.getMessage());
        }
    }

    /** Grava um arquivo qualquer (exportações, zip) em Downloads/KM Check. Devolve { uri }. */
    @PluginMethod
    public void salvarArquivo(PluginCall call) {
        String nome = call.getString("nome", "km-check.bin");
        String mime = call.getString("mime", "application/octet-stream");
        byte[] dados = decodifica(call);
        if (dados == null) return;
        try {
            Uri uri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, nome);
                v.put(MediaStore.Downloads.MIME_TYPE, mime);
                v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + PASTA);
                v.put(MediaStore.Downloads.IS_PENDING, 1);
                ContentResolver cr = getContext().getContentResolver();
                uri = cr.insert(MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
                if (uri == null) throw new Exception("Downloads indisponível");
                try (OutputStream os = cr.openOutputStream(uri)) { os.write(dados); }
                v.clear();
                v.put(MediaStore.Downloads.IS_PENDING, 0);
                cr.update(uri, v, null, null);
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), PASTA);
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("não consegui criar a pasta");
                File f = new File(dir, nome);
                try (FileOutputStream os = new FileOutputStream(f)) { os.write(dados); }
                uri = Uri.fromFile(f);
            }
            JSObject r = new JSObject();
            r.put("uri", uri.toString());
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Não consegui salvar o arquivo: " + e.getMessage());
        }
    }

    /** Abre o "Compartilhar" do Android com um arquivo (base64). */
    @PluginMethod
    public void compartilhar(PluginCall call) {
        String nome = call.getString("nome", "km-check.jpg");
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
        } catch (Exception e) {
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

    private byte[] decodifica(PluginCall call) {
        String b64 = call.getString("base64");
        if (b64 == null || b64.isEmpty()) { call.reject("Arquivo vazio."); return null; }
        int virgula = b64.indexOf(',');
        if (b64.startsWith("data:") && virgula > 0) b64 = b64.substring(virgula + 1);
        try { return Base64.decode(b64, Base64.DEFAULT); }
        catch (IllegalArgumentException e) { call.reject("Arquivo inválido."); return null; }
    }
}
