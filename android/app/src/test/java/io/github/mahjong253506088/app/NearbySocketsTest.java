package io.github.mahjong253506088.app;

import org.junit.*;
import static org.junit.Assert.*;
import java.io.*;
import java.nio.file.*;
import java.security.*;
import java.util.concurrent.*;
import javax.net.ssl.*;
import com.google.zxing.*;
import com.google.zxing.common.*;

public class NearbySocketsTest {
    private static SSLContext context;
    private NearbySockets host, guest;
    private final BlockingQueue<String> received = new LinkedBlockingQueue<>();
    private final BlockingQueue<String> connections = new LinkedBlockingQueue<>();
    @BeforeClass public static void certificate() throws Exception {
        Path folder = Files.createTempDirectory("mahjong-tls-test-");
        Path keys = folder.resolve("server.p12");
        String binary = System.getProperty("os.name").startsWith("Windows") ? "keytool.exe" : "keytool";
        Process p = new ProcessBuilder(Paths.get(System.getProperty("java.home"), "bin", binary).toString(),
            "-genkeypair", "-alias", "test", "-keyalg", "RSA", "-keystore", keys.toString(), "-storetype", "PKCS12",
            "-storepass", "testing-only", "-keypass", "testing-only", "-dname", "CN=Nearby test", "-validity", "1", "-noprompt")
            .redirectErrorStream(true).redirectOutput(folder.resolve("keytool.log").toFile()).start();
        assertTrue(p.waitFor(30, TimeUnit.SECONDS)); assertEquals(0, p.exitValue());
        KeyStore store = KeyStore.getInstance("PKCS12");
        try (InputStream in = Files.newInputStream(keys)) { store.load(in, "testing-only".toCharArray()); }
        KeyManagerFactory km = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()); km.init(store, "testing-only".toCharArray());
        TrustManagerFactory tm = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()); tm.init(store);
        context = SSLContext.getInstance("TLS"); context.init(km.getKeyManagers(), tm.getTrustManagers(), new SecureRandom());
        Files.delete(keys); Files.deleteIfExists(folder.resolve("keytool.log")); Files.delete(folder);
    }
    private NearbySockets.Listener listener(boolean server) {
        return new NearbySockets.Listener() {
            public void connected(String peer) { connections.offer((server ? "server:" : "client:") + peer); }
            public void message(String peer, String data) { received.offer(data); }
            public void disconnected(String peer) { }
        };
    }
    @Before public void connect() throws Exception {
        host = new NearbySockets(listener(true)); guest = new NearbySockets(listener(false));
        int port = host.host(context, 0); guest.join(context, "127.0.0.1", port);
        assertNotNull(connections.poll(10, TimeUnit.SECONDS)); assertNotNull(connections.poll(10, TimeUnit.SECONDS));
    }
    @After public void close() { host.close(); guest.close(); }
    @Test public void largeUnicodeFramesArriveWholeAndInOrder() throws Exception {
        String message = "麻将🀄重连东南西北".repeat(9000);
        guest.send("host", message); assertEquals(message, received.poll(10, TimeUnit.SECONDS));
        for (int i = 0; i < 64; i++) guest.send("host", "frame-" + i);
        for (int i = 0; i < 64; i++) assertEquals("frame-" + i, received.poll(10, TimeUnit.SECONDS));
    }
    @Test public void oversizedFramesAreRejectedWithoutCorruptingTheConnection() throws Exception {
        try { guest.send("host", "x".repeat(NearbySockets.MAX_FRAME + 1)); fail("Oversized message accepted"); }
        catch (IOException expected) { }
        guest.send("host", "still-connected"); assertEquals("still-connected", received.poll(10, TimeUnit.SECONDS));
    }
    @Test public void heartbeatPreservesIdleConnectionBeyondReadTimeout() throws Exception {
        Thread.sleep(13000);
        guest.send("host", "no-turn-limit"); assertEquals("no-turn-limit", received.poll(10, TimeUnit.SECONDS));
    }
    @Test public void qrRoundTripUsesTheBundledOfflineDecoder() throws Exception {
        String invite = "mahjong-nearby:{\"v\":1,\"room\":\"" + "a".repeat(48) + "\",\"key\":\"" + "b".repeat(48)
            + "\",\"hosts\":[\"192.168.43.1\"],\"port\":35000,\"fingerprint\":\"" + "c".repeat(64) + "\"}";
        BitMatrix bits = new MultiFormatWriter().encode(invite, BarcodeFormat.QR_CODE, 720, 720);
        int[] pixels = new int[720 * 720];
        for (int y = 0; y < 720; y++) for (int x = 0; x < 720; x++) pixels[y * 720 + x] = bits.get(x, y) ? 0xff10251f : 0xffffffff;
        BinaryBitmap bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(720, 720, pixels)));
        assertEquals(invite, new MultiFormatReader().decode(bitmap).getText());
    }
}
