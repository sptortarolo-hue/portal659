package ar.portal659.socket;

import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.util.Base64;
import android.view.Window;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "PortalSocket")
public class PortalSocketPlugin extends Plugin {

  private static final int SCAN_HOSTS = 254;

  @PluginMethod
  public void print(PluginCall call) {
    String ip = call.getString("ip");
    Integer port = call.getInt("port", 9100);
    String dataBase64 = call.getString("dataBase64");

    if (ip == null || dataBase64 == null) {
      call.reject("ip y dataBase64 son requeridos");
      return;
    }

    final byte[] data;
    try {
      data = Base64.decode(dataBase64, Base64.DEFAULT);
    } catch (IllegalArgumentException e) {
      call.reject("base64 inválido");
      return;
    }

    ExecutorService executor = Executors.newSingleThreadExecutor();
    executor.execute(() -> {
      try (Socket socket = new Socket()) {
        socket.connect(new InetSocketAddress(ip, port), 5000);
        socket.getOutputStream().write(data);
        socket.getOutputStream().flush();
        JSObject result = new JSObject();
        result.put("bytes", data.length);
        call.resolve(result);
      } catch (Exception e) {
        call.reject("No se pudo enviar a la impresora (" + ip + ":" + port + "): " + e.getMessage());
      } finally {
        executor.shutdown();
      }
    });
  }

  @PluginMethod
  public void discover(PluginCall call) {
    int port = call.getInt("port", 9100);
    int timeoutMs = Math.max(100, Math.min(1000, call.getInt("timeoutMs", 150)));

    final String subnet = localSubnet();
    if (subnet == null) {
      call.reject("No se pudo determinar la red local (¿estás conectado al Wi-Fi?)");
      return;
    }

    ExecutorService pool = Executors.newFixedThreadPool(64);
    List<String> found = Collections.synchronizedList(new ArrayList<>());
    CountDownLatch latch = new CountDownLatch(SCAN_HOSTS);

    for (int host = 1; host <= SCAN_HOSTS; host++) {
      final String target = subnet + "." + host;
      pool.execute(() -> {
        try (Socket socket = new Socket()) {
          socket.connect(new InetSocketAddress(target, port), timeoutMs);
          found.add(target);
        } catch (Exception ignored) {
          // host no responde en ese puerto
        } finally {
          latch.countDown();
        }
      });
    }

    pool.execute(() -> {
      try {
        latch.await(15, TimeUnit.SECONDS);
      } catch (InterruptedException ignored) {
        // devolvemos lo que haya
      }
      List<String> sorted = new ArrayList<>(found);
      Collections.sort(sorted);
      JSONArray hosts = new JSONArray(sorted);
      JSObject result = new JSObject();
      result.put("hosts", hosts);
      call.resolve(result);
      pool.shutdown();
    });
  }

  @PluginMethod
  public void keepAwake(PluginCall call) {
    boolean enabled = call.getBoolean("enabled", true);
    getActivity().runOnUiThread(() -> {
      Window window = getActivity().getWindow();
      if (window == null) return;
      if (enabled) {
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
      } else {
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
      }
    });
    // Además de mantener la pantalla, levantamos el foreground service para que
    // Android no mate el proceso (y con él el WebSocket al relay).
    Context ctx = getContext();
    Intent svc = new Intent(ctx, PortalPrintService.class);
    if (enabled) {
      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
        ctx.startForegroundService(svc);
      } else {
        ctx.startService(svc);
      }
    } else {
      ctx.stopService(svc);
    }
    call.resolve();
  }

  /** Lee/escribe la flag "activo por reinicio o apagado por usuario". */
  private boolean isEnabledPersisted() {
    return getContext().getSharedPreferences("portalprint", Context.MODE_PRIVATE)
      .getBoolean("enabled", true);
  }
  private void setEnabledPersisted(boolean v) {
    getContext().getSharedPreferences("portalprint", Context.MODE_PRIVATE)
      .edit().putBoolean("enabled", v).apply();
  }

  /** Detiene todo: mismo efecto de "apagar el negocio" (WS se cierrel, FG service termina). */
  @PluginMethod
  public void setActive(PluginCall call) {
    boolean active = call.getBoolean("active", true);
    Context ctx = getContext();

    if (!active) {
      // Cierra servicio + suelta la pantalla
      Intent svc = new Intent(ctx, PortalPrintService.class);
      ctx.stopService(svc);
      getActivity().runOnUiThread(() -> {
        Window window = getActivity().getWindow();
        if (window != null) window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
      });
    } else {
      // Reinicia el servicio si está habilitado
      Intent svc = new Intent(ctx, PortalPrintService.class);
      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
        ctx.startForegroundService(svc);
      } else {
        ctx.startService(svc);
      }
    }

    setEnabledPersisted(active);
    call.resolve();
  }

  /** Para que la app sepa si está apagado por el usuario. */
  @PluginMethod
  public void isEnabled(PluginCall call) {
    JSObject result = new JSObject();
    result.put("enabled", isEnabledPersisted());
    call.resolve(result);
  }

  /** Pide el permiso POST_NOTIFICATIONS (Android 13+) para que se vea la notif fija del FG service. */
  @PluginMethod
  public void requestNotifPermission(PluginCall call) {
    if (android.os.Build.VERSION.SDK_INT >= 33) {
      getActivity().requestPermissions(
        new String[] { "android.permission.POST_NOTIFICATIONS" },
        42659
      );
    }
    call.resolve();
  }

  /** Abre el diálogo oficial de Android para excluir la app de la optimización de batería. */
  @PluginMethod
  public void requestBatteryExemption(PluginCall call) {
    try {
      Context ctx = getContext();
      Intent intent = new Intent(
        android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
        android.net.Uri.parse("package:" + ctx.getPackageName())
      );
      ctx.startActivity(intent);
      call.resolve();
    } catch (Exception e) {
      // Fallback a los ajustes generales de batería
      try {
        getContext().startActivity(new Intent(android.provider.Settings.ACTION_SETTINGS));
        call.resolve();
      } catch (Exception e2) {
        call.reject("No se pudo abrir la configuración de batería: " + e2.getMessage());
      }
    }
  }

  private String localSubnet() {
    Context context = getContext();
    ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
    if (cm == null) return null;
    Network network = cm.getActiveNetwork();
    if (network == null) return null;
    LinkProperties lp = cm.getLinkProperties(network);
    if (lp == null) return null;
    for (LinkAddress address : lp.getLinkAddresses()) {
      InetAddress inet = address.getAddress();
      if (inet instanceof Inet4Address && !inet.isLoopbackAddress()) {
        String[] parts = inet.getHostAddress().split("\\.");
        if (parts.length == 4) {
          return parts[0] + "." + parts[1] + "." + parts[2];
        }
      }
    }
    return null;
  }
}