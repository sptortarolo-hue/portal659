package ar.portal659.reparto;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "RepartoLocation")
public class RepartoLocationPlugin extends Plugin {

  private static final String PREFS = "portalreparto";
  private static final int REQ_LOCATION = 42661;

  private SharedPreferences prefs() {
    return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  private boolean fineGranted() {
    Context ctx = getContext();
    return ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        || ctx.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
  }

  private boolean backgroundGranted() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true;
    return getContext().checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
  }

  /** Inicia el FG service de ubicación para un pedido (persiste para reboot). */
  @PluginMethod
  public void startSharing(PluginCall call) {
    String orderId = call.getString("orderId", "");
    String token = call.getString("token", "");
    String serverUrl = call.getString("serverUrl", "https://www.portal659.com.ar");
    String label = call.getString("label", "Tu entrega");
    if (orderId.isEmpty() || token.isEmpty()) {
      call.reject("orderId y token son requeridos");
      return;
    }
    Intent svc = new Intent(getContext(), RepartoLocationService.class)
        .putExtra("orderId", orderId)
        .putExtra("token", token)
        .putExtra("serverUrl", serverUrl)
        .putExtra("orderLabel", label);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      getContext().startForegroundService(svc);
    } else {
      getContext().startService(svc);
    }
    call.resolve();
  }

  /** Detiene el servicio y borra el pedido persistido. */
  @PluginMethod
  public void stopSharing(PluginCall call) {
    prefs().edit().putBoolean("sharing", false).putString("orderId", "").apply();
    getContext().stopService(new Intent(getContext(), RepartoLocationService.class));
    call.resolve();
  }

  /** Estado: sharing + último fix + permisos (para la UI). */
  @PluginMethod
  public void status(PluginCall call) {
    SharedPreferences p = prefs();
    JSObject result = new JSObject();
    result.put("sharing", p.getBoolean("sharing", false));
    result.put("orderId", p.getString("orderId", ""));
    result.put("label", p.getString("orderLabel", ""));
    result.put("lastFixAt", p.getLong("lastFixAt", 0));
    result.put("locationGranted", fineGranted());
    result.put("backgroundGranted", backgroundGranted());
    call.resolve(result);
  }

  /**
   * Pide permisos en el orden que exige Android: primero FINE+COARSE; cuando
   * ya están dados, pide BACKGROUND por separado (Android 10+ lo exige así;
   * pedirlos juntos se ignora en silencio). Llamar hasta backgroundGranted.
   */
  @PluginMethod
  public void requestLocationPermissions(PluginCall call) {
    if (!fineGranted()) {
      getActivity().requestPermissions(
          new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION },
          REQ_LOCATION);
    } else if (!backgroundGranted()) {
      getActivity().requestPermissions(
          new String[] { Manifest.permission.ACCESS_BACKGROUND_LOCATION },
          REQ_LOCATION);
    }
    status(call);
  }

  /** POST_NOTIFICATIONS (Android 13+) para la notificación fija del servicio. */
  @PluginMethod
  public void requestNotifPermission(PluginCall call) {
    if (Build.VERSION.SDK_INT >= 33) {
      getActivity().requestPermissions(
          new String[] { "android.permission.POST_NOTIFICATIONS" },
          REQ_LOCATION);
    }
    call.resolve();
  }

  /** Diálogo oficial para excluir la app de la optimización de batería. */
  @PluginMethod
  public void requestBatteryExemption(PluginCall call) {
    try {
      Context ctx = getContext();
      Intent intent = new Intent(
          android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
          android.net.Uri.parse("package:" + ctx.getPackageName()));
      ctx.startActivity(intent);
      call.resolve();
    } catch (Exception e) {
      try {
        getContext().startActivity(new Intent(android.provider.Settings.ACTION_SETTINGS));
        call.resolve();
      } catch (Exception e2) {
        call.reject("No se pudo abrir la configuración de batería: " + e2.getMessage());
      }
    }
  }
}
