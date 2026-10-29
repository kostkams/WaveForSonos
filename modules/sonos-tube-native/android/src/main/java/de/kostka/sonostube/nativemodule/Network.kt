package de.kostka.sonostube.nativemodule

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.util.Log
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.SocketTimeoutException
import java.util.Locale

object NetworkUtils {
  private const val TAG = "SonosTubeNet"

  /** IPv4 of the Wi-Fi (or Ethernet) interface; falls back to any site-local IPv4. */
  fun getLocalIp(context: Context): String? {
    try {
      val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      @Suppress("DEPRECATION")
      val networks = cm.allNetworks.toMutableList()
      cm.activeNetwork?.let { active -> networks.remove(active); networks.add(0, active) }
      fun ipv4Of(n: android.net.Network): String? =
        cm.getLinkProperties(n)?.linkAddresses
          ?.map { it.address }
          ?.firstOrNull { it is Inet4Address && !it.isLoopbackAddress }
          ?.hostAddress
      // Prefer LAN transports (Sonos lives on the local network, not on cellular).
      for (n in networks) {
        val caps = cm.getNetworkCapabilities(n) ?: continue
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) {
          ipv4Of(n)?.let { return it }
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "ConnectivityManager lookup failed", e)
    }
    // Fallback: enumerate interfaces (wlan0, eth0, ap0 …).
    try {
      val candidates = NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
        .filter { it.isUp && !it.isLoopback }
        .sortedBy { if (it.name.startsWith("wlan") || it.name.startsWith("eth")) 0 else 1 }
      for (nif in candidates) {
        nif.inetAddresses.toList().firstOrNull { it is Inet4Address && it.isSiteLocalAddress }?.let { return it.hostAddress }
      }
    } catch (e: Exception) {
      Log.w(TAG, "NetworkInterface lookup failed", e)
    }
    return null
  }
}

object SsdpDiscovery {
  private const val TAG = "SonosTubeSsdp"
  private const val SSDP_ADDR = "239.255.255.250"
  private const val SSDP_PORT = 1900
  private const val ST = "urn:schemas-upnp-org:device:ZonePlayer:1"

  /** Blocking SSDP M-SEARCH for Sonos ZonePlayers. Returns [{ip, location}]. */
  fun discover(context: Context, timeoutMs: Long): List<Map<String, Any?>> {
    val timeout = timeoutMs.coerceIn(500, 30_000)
    val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    val lock = wifi.createMulticastLock("SonosTube:ssdp").apply { setReferenceCounted(false) }
    val found = LinkedHashMap<String, String>()
    try {
      lock.acquire()
      DatagramSocket(null).use { socket ->
        socket.reuseAddress = true
        val localIp = NetworkUtils.getLocalIp(context)
        val bindAddr = localIp?.let { runCatching { InetAddress.getByName(it) }.getOrNull() }
        socket.bind(InetSocketAddress(bindAddr, 0))
        socket.broadcast = true
        val message = (
          "M-SEARCH * HTTP/1.1\r\n" +
            "HOST: $SSDP_ADDR:$SSDP_PORT\r\n" +
            "MAN: \"ssdp:discover\"\r\n" +
            "MX: 1\r\n" +
            "ST: $ST\r\n" +
            "\r\n"
          ).toByteArray(Charsets.US_ASCII)
        val target = InetSocketAddress(InetAddress.getByName(SSDP_ADDR), SSDP_PORT)
        val start = System.currentTimeMillis()
        val deadline = start + timeout
        val sendTimes = longArrayOf(0, 300, 900)
        var sent = 0
        val buf = ByteArray(2048)
        while (true) {
          val now = System.currentTimeMillis()
          if (now >= deadline) break
          while (sent < sendTimes.size && now - start >= sendTimes[sent]) {
            try {
              socket.send(DatagramPacket(message, message.size, target))
            } catch (e: Exception) {
              Log.w(TAG, "M-SEARCH send failed", e)
            }
            sent++
          }
          val nextSend = if (sent < sendTimes.size) start + sendTimes[sent] else deadline
          val wait = (minOf(deadline, nextSend) - System.currentTimeMillis()).coerceAtLeast(1)
          socket.soTimeout = wait.toInt()
          try {
            val packet = DatagramPacket(buf, buf.size)
            socket.receive(packet)
            val text = String(packet.data, 0, packet.length, Charsets.UTF_8)
            val headers = parseHeaders(text)
            val ip = packet.address?.hostAddress ?: continue
            val location = headers["location"] ?: continue
            val st = headers["st"] ?: ""
            val server = headers["server"] ?: ""
            val isSonos = st.equals(ST, ignoreCase = true) || server.contains("sonos", ignoreCase = true) ||
              headers.containsKey("x-rincon-household")
            if (isSonos && !found.containsKey(ip)) found[ip] = location
          } catch (_: SocketTimeoutException) {
            // loop: maybe send again or finish
          }
        }
      }
    } finally {
      try { if (lock.isHeld) lock.release() } catch (_: Exception) {}
    }
    return found.map { (ip, location) -> mapOf("ip" to ip, "location" to location) }
  }

  fun parseHeaders(response: String): Map<String, String> {
    val map = HashMap<String, String>()
    response.split("\r\n", "\n").drop(1).forEach { line ->
      val c = line.indexOf(':')
      if (c > 0) map[line.substring(0, c).trim().lowercase(Locale.ROOT)] = line.substring(c + 1).trim()
    }
    return map
  }
}
