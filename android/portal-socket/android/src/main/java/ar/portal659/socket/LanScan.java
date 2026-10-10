package ar.portal659.socket;

import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Barrido LAN buscando hosts con un puerto TCP abierto (impresoras ESC/POS).
 * Sin dependencias. Lo usan el plugin (botón Buscar) y el servicio
 * (auto-fix cuando la IP configurada muere).
 */
public final class LanScan {
    private LanScan() {}

    public static final int SCAN_HOSTS = 254;
    private static final int CONCURRENCY = 64;

    /**
     * Escanea subredes /24. Devuelve hosts ordenados que aceptaron el puerto.
     * Acotado en tiempo: timeoutMs por host + tope global.
     */
    public static List<String> scan(List<String> subnets, int port, int timeoutMs) {
        if (subnets == null || subnets.isEmpty() || port <= 0 || port > 65535) {
            return Collections.emptyList();
        }
        final int perHost = Math.max(100, Math.min(1000, timeoutMs));
        final List<String> targets = new ArrayList<>();
        for (String net : subnets) {
            if (net == null) continue;
            String base = net.trim();
            if (base.isEmpty()) continue;
            for (int h = 1; h <= SCAN_HOSTS; h++) targets.add(base + "." + h);
        }
        if (targets.isEmpty()) return Collections.emptyList();

        final List<String> found = Collections.synchronizedList(new ArrayList<String>());
        final CountDownLatch latch = new CountDownLatch(targets.size());
        ExecutorService pool = Executors.newFixedThreadPool(CONCURRENCY);
        try {
            for (final String target : targets) {
                pool.execute(() -> {
                    try (Socket socket = new Socket()) {
                        socket.connect(new InetSocketAddress(target, port), perHost);
                        found.add(target);
                    } catch (Exception ignored) {
                        // host no responde en ese puerto
                    } finally {
                        latch.countDown();
                    }
                });
            }
            try {
                latch.await(Math.max(3000, perHost * 6L + 4000L), TimeUnit.MILLISECONDS);
            } catch (InterruptedException ignored) {
                // devolvemos lo que haya
            }
        } finally {
            pool.shutdownNow();
        }
        List<String> sorted = new ArrayList<>(found);
        Collections.sort(sorted);
        return sorted;
    }
}
