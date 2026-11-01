package io.github.mahjong253506088.app;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import javax.net.ssl.*;

/** Framed TLS streams. Android and JVM tests use the exact same transport. */
public final class NearbySockets implements AutoCloseable {
    public interface Listener {
        void connected(String peer);
        void message(String peer, String data);
        void disconnected(String peer);
        default void failed(String peer, String reason) { }
    }
    public static final int MAX_FRAME = 512 * 1024;
    private final Listener listener;
    private final ExecutorService workers = Executors.newCachedThreadPool();
    private final ScheduledExecutorService heartbeat = Executors.newSingleThreadScheduledExecutor();
    private final ConcurrentMap<String, Peer> peers = new ConcurrentHashMap<>();
    private volatile SSLServerSocket server;
    private volatile boolean closed;
    public NearbySockets(Listener listener) {
        this.listener = listener;
        heartbeat.scheduleAtFixedRate(() -> peers.values().forEach(p -> p.send("")), 2, 2, TimeUnit.SECONDS);
    }
    public int host(SSLContext context, int port) throws IOException {
        server = (SSLServerSocket) context.getServerSocketFactory().createServerSocket();
        server.setReuseAddress(true);
        server.bind(new InetSocketAddress(port));
        workers.execute(() -> {
            while (!closed) {
                try {
                    SSLSocket socket = (SSLSocket) server.accept();
                    if (peers.size() >= 12) { socket.close(); continue; }
                    attach(UUID.randomUUID().toString(), socket);
                } catch (IOException e) { if (!closed) close(); }
            }
        });
        return server.getLocalPort();
    }
    public void join(SSLContext context, String host, int port) throws IOException {
        SSLSocket socket = (SSLSocket) context.getSocketFactory().createSocket();
        try { socket.connect(new InetSocketAddress(host, port), 3500); attach("host", socket); }
        catch (IOException e) { socket.close(); throw e; }
    }
    private void attach(String id, SSLSocket socket) {
        Peer peer = new Peer(id, socket);
        Peer old = peers.put(id, peer);
        if (old != null) old.close();
        workers.execute(peer::read);
    }
    public void send(String peer, String data) throws IOException {
        Peer p = peers.get(peer);
        if (p == null) throw new IOException("连接已断开");
        if (data.getBytes(StandardCharsets.UTF_8).length > MAX_FRAME) throw new IOException("房间消息过大");
        try { p.enqueue(data).get(3, TimeUnit.SECONDS); }
        catch (Exception e) { p.close(); throw new IOException("发送失败，正在重连", e); }
    }
    public void disconnect(String peer) { Peer p = peers.get(peer); if (p != null) p.close(); }
    @Override public void close() {
        closed = true;
        try { if (server != null) server.close(); } catch (IOException ignored) { }
        peers.values().forEach(Peer::close);
        heartbeat.shutdownNow(); workers.shutdownNow();
    }
    private static final class Frame {
        final String data;
        final CompletableFuture<Void> flushed = new CompletableFuture<>();
        Frame(String data) { this.data = data; }
    }
    private final class Peer {
        final String id;
        final SSLSocket socket;
        final BlockingQueue<Frame> outgoing = new ArrayBlockingQueue<>(32);
        volatile boolean dead;
        Peer(String id, SSLSocket socket) { this.id = id; this.socket = socket; }
        void send(String data) { enqueue(data); }
        CompletableFuture<Void> enqueue(String data) {
            Frame frame = new Frame(data);
            if (dead || !outgoing.offer(frame)) { frame.flushed.completeExceptionally(new IOException("Closed")); close(); }
            return frame.flushed;
        }
        void read() {
            try {
                socket.setSoTimeout(12000);
                socket.setTcpNoDelay(true);
                socket.startHandshake();
                workers.execute(this::write);
                listener.connected(id);
                DataInputStream input = new DataInputStream(socket.getInputStream());
                while (!dead) {
                    int length = input.readInt();
                    if (length < 0 || length > MAX_FRAME) throw new IOException("Invalid frame");
                    byte[] bytes = new byte[length]; input.readFully(bytes);
                    if (length > 0) listener.message(id, new String(bytes, StandardCharsets.UTF_8));
                }
            } catch (IOException | RuntimeException e) { if (!dead) listener.failed(id, e.getClass().getSimpleName() + ": " + e.getMessage()); }
            finally { close(); }
        }
        void write() {
            try {
                DataOutputStream output = new DataOutputStream(socket.getOutputStream());
                while (!dead) {
                    Frame frame = outgoing.take();
                    byte[] data = frame.data.getBytes(StandardCharsets.UTF_8);
                    try { output.writeInt(data.length); output.write(data); output.flush(); frame.flushed.complete(null); }
                    catch (IOException e) { frame.flushed.completeExceptionally(e); throw e; }
                }
            } catch (IOException | InterruptedException ignored) { }
            finally { close(); }
        }
        synchronized void close() {
            if (dead) return;
            dead = true;
            try { socket.close(); } catch (IOException ignored) { }
            outgoing.forEach(f -> f.flushed.completeExceptionally(new IOException("Closed")));
            outgoing.clear(); outgoing.offer(new Frame(""));
            if (peers.remove(id, this)) listener.disconnected(id);
        }
    }
}
