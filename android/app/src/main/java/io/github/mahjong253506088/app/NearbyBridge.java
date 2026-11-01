package io.github.mahjong253506088.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.WebView;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.webkit.JavaScriptReplyProxy;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.MultiFormatWriter;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;
import org.json.*;
import java.io.*;
import java.math.BigInteger;
import java.net.*;
import java.security.*;
import java.security.spec.ECGenParameterSpec;
import java.security.cert.X509Certificate;
import java.util.*;
import java.util.concurrent.*;
import javax.net.ssl.*;
import javax.security.auth.x500.X500Principal;

/** Narrow origin-checked bridge: the game never enables mixed content or file access. */
public final class NearbyBridge implements AutoCloseable {
    private static final String KEY_ALIAS = "mahjong-nearby-ec-v1";
    private final Activity activity;
    private final ExecutorService commands = Executors.newSingleThreadExecutor();
    private volatile JavaScriptReplyProxy reply;
    private volatile NearbySockets sockets;
    private String scanId;
    private volatile boolean active;
    public NearbyBridge(Activity activity, WebView webView) {
        this.activity = activity;
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        WebViewCompat.addWebMessageListener(webView, "MahjongNearby", Collections.singleton("https://" + MainActivity.HOST),
            (view, message, origin, mainFrame, proxy) -> {
                if (!mainFrame || !"https".equals(origin.getScheme()) || !MainActivity.HOST.equals(origin.getHost())) return;
                reply = proxy;
                String data = message.getData();
                if (data == null || data.length() > NearbySockets.MAX_FRAME * 2) return;
                commands.execute(() -> handle(data));
            });
    }
    public boolean isActive() { return active; }
    private void post(JSONObject value) {
        activity.runOnUiThread(() -> { if (reply != null) try { reply.postMessage(value.toString()); } catch (RuntimeException ignored) { } });
    }
    private JSONObject object(Object... values) {
        JSONObject o = new JSONObject();
        try { for (int i = 0; i < values.length; i += 2) o.put((String) values[i], values[i + 1]); }
        catch (JSONException ignored) { }
        return o;
    }
    private void event(String kind, String peer, String data) { post(object("event", kind, "peer", peer, "data", data)); }
    private void stop() { active = false; NearbySockets old = sockets; sockets = null; if (old != null) old.close(); }
    private NearbySockets transport() {
        final NearbySockets[] source = new NearbySockets[1];
        source[0] = new NearbySockets(new NearbySockets.Listener() {
            private void deliver(String kind, String peer, String data) {
                activity.runOnUiThread(() -> { if (sockets == source[0]) event(kind, peer, data); });
            }
            public void connected(String peer) { deliver("connected", peer, ""); }
            public void message(String peer, String data) { deliver("message", peer, data); }
            public void disconnected(String peer) { deliver("disconnected", peer, ""); }
            public void failed(String peer, String reason) {
                android.util.Log.w("MahjongNearby", reason);
                if ("host".equals(peer)) deliver("connectionError", peer, "连接房主失败，请确认 Wi-Fi / 热点相同，或重新扫描房主二维码");
            }
        });
        return source[0];
    }
    private void handle(String text) {
        String id = "";
        try {
            JSONObject request = new JSONObject(text); id = request.getString("id");
            String op = request.getString("op"); JSONObject args = request.optJSONObject("args");
            Object result = true;
            switch (op) {
                case "host": {
                    stop(); sockets = transport();
                    KeyStore keys = serverKeys();
                    KeyManagerFactory km = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()); km.init(keys, null);
                    SSLContext context = SSLContext.getInstance("TLS"); context.init(km.getKeyManagers(), null, new SecureRandom());
                    int port = sockets.host(context, args.optInt("port", 0));
                    JSONArray hosts = localAddresses();
                    if (hosts.length() == 0) { stop(); throw new IOException("请先连接 Wi-Fi，或打开手机热点"); }
                    result = object("hosts", hosts, "port", port, "fingerprint", fingerprint((X509Certificate) keys.getCertificate(KEY_ALIAS)));
                    active = true; break;
                }
                case "join": {
                    stop(); sockets = transport();
                    String host = args.getString("host");
                    if (!privateAddress(host)) throw new IOException("只允许同一 Wi-Fi 或热点内的房间地址");
                    int port = args.getInt("port");
                    if (port < 1024 || port > 65535) throw new IOException("无效端口");
                    String pin = args.getString("fingerprint");
                    SSLContext context = SSLContext.getInstance("TLS");
                    context.init(null, new TrustManager[]{new X509TrustManager() {
                        public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                        public void checkClientTrusted(X509Certificate[] chain, String type) throws java.security.cert.CertificateException { throw new java.security.cert.CertificateException(); }
                        public void checkServerTrusted(X509Certificate[] chain, String type) throws java.security.cert.CertificateException {
                            try { if (chain.length == 0 || !MessageDigest.isEqual(fingerprint(chain[0]).getBytes(java.nio.charset.StandardCharsets.US_ASCII), pin.getBytes(java.nio.charset.StandardCharsets.US_ASCII))) throw new Exception(); }
                            catch (Exception e) { throw new java.security.cert.CertificateException("房主身份与二维码不符"); }
                        }
                    }}, new SecureRandom());
                    sockets.join(context, host, port); active = true; break;
                }
                case "send": if (sockets == null) throw new IOException("连接已断开"); else sockets.send(args.getString("peer"), args.getString("data")); break;
                case "disconnect": if (sockets != null) sockets.disconnect(args.getString("peer")); break;
                case "stop": stop(); break;
                case "addresses": result = localAddresses(); break;
                case "qr": {
                    String value = args.getString("text");
                    if (value.length() > 4096) throw new IOException("二维码内容过长");
                    BitMatrix bits = new MultiFormatWriter().encode(value, BarcodeFormat.QR_CODE, 720, 720);
                    Bitmap bitmap = Bitmap.createBitmap(720, 720, Bitmap.Config.ARGB_8888);
                    for (int y = 0; y < 720; y++) for (int x = 0; x < 720; x++) bitmap.setPixel(x, y, bits.get(x, y) ? 0xff10251f : 0xffffffff);
                    ByteArrayOutputStream output = new ByteArrayOutputStream(); bitmap.compress(Bitmap.CompressFormat.PNG, 100, output); bitmap.recycle();
                    result = "data:image/png;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP); break;
                }
                case "scan": {
                    if (scanId != null) throw new IOException("扫码已打开");
                    scanId = id;
                    activity.runOnUiThread(() -> new IntentIntegrator(activity).setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
                        .setPrompt("扫描房主手机上的房间二维码").setBeepEnabled(false).setOrientationLocked(false).initiateScan());
                    return;
                }
                default: throw new IOException("Unsupported nearby operation");
            }
            post(object("id", id, "result", result));
        } catch (Exception e) { post(object("id", id, "error", e.getMessage() == null ? "附近联机暂不可用" : e.getMessage())); }
    }
    public boolean onActivityResult(int request, int result, Intent data) {
        IntentResult scan = IntentIntegrator.parseActivityResult(request, result, data);
        if (scan == null) return false;
        if (scanId != null) post(object("id", scanId, "result", scan.getContents() == null ? "" : scan.getContents()));
        scanId = null; return true;
    }
    static boolean privateAddress(String host) {
        if (!host.matches("\\d{1,3}(\\.\\d{1,3}){3}")) return false;
        String[] parts = host.split("\\."); int[] p = new int[4];
        for (int i = 0; i < 4; i++) { p[i] = Integer.parseInt(parts[i]); if (p[i] > 255) return false; }
        return p[0] == 10 || p[0] == 192 && p[1] == 168 || p[0] == 172 && p[1] >= 16 && p[1] <= 31;
    }
    private JSONArray localAddresses() throws SocketException {
        JSONArray result = new JSONArray();
        for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
            if (!network.isUp() || network.isLoopback()) continue;
            for (InetAddress address : Collections.list(network.getInetAddresses())) {
                if (address instanceof Inet4Address && privateAddress(address.getHostAddress()) && result.length() < 8) result.put(address.getHostAddress());
            }
        }
        return result;
    }
    private static KeyStore serverKeys() throws Exception {
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore"); keys.load(null);
        if (!keys.containsAlias(KEY_ALIAS)) {
            KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
            generator.initialize(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
                // Conscrypt signs prehashed transcripts with NONEwithECDSA.
                .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_NONE, KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA384, KeyProperties.DIGEST_SHA512)
                .setCertificateSubject(new X500Principal("CN=Mahjong Nearby"))
                .setCertificateSerialNumber(BigInteger.ONE).setCertificateNotAfter(new Date(4102444800000L)).build());
            generator.generateKeyPair(); keys.load(null);
        }
        return keys;
    }
    private static String fingerprint(X509Certificate certificate) throws Exception {
        byte[] hash = MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded());
        StringBuilder text = new StringBuilder(); for (byte b : hash) text.append(String.format(Locale.ROOT, "%02x", b & 255)); return text.toString();
    }
    public void foreground(boolean foreground) { event(foreground ? "foreground" : "background", "", ""); }
    @Override public void close() { stop(); commands.shutdownNow(); }
}
