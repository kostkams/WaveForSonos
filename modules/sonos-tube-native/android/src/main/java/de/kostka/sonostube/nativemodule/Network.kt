package de.kostka.sonostube.nativemodule

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.util.Log
import java.net.DatagramPacket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
import java.net.NetworkInterface
import java.net.SocketTimeoutException
import java.util.Locale
import java.util.concurrent.Executors
import javax.net.SocketFactory

/** The phone's LAN (Wi-Fi/Ethernet) link: Android network handle, interface and IPv4 with prefix length. */
data class LanLink(
  val network: android.net.Network?,
  val nif: NetworkInterface?,
  val address: Inet4Address,
  val prefixLength: Int
)

object NetworkUtils {
  private const val TAG = "SonosTubeNet"

  /** IPv4 of the Wi-Fi (or Ethernet) interface; falls back to any site-local IPv4. */
  fun getLocalIp(context: Context): String? = lanLink(context)?.address?.hostAddress

  /** Finds the Wi-Fi/Ethernet link, so LAN traffic never leaves through cellular or a VPN. */
  fun lanLink(context: Context): LanLink? {
    try {
      val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      @Suppress("DEPRECATION")
      val networks = cm.allNetworks.toMutableList()
      cm.activeNetwork?.let { active -> networks.remove(active); networks.add(0, active) }
      for (n in networks) {
        val caps = cm.getNetworkCapabilities(n) ?: continue
        if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) && !caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) continue
        val props = cm.getLinkProperties(n) ?: continue
        val la = props.linkAddresses.firstOrNull { it.address is Inet4Address && !it.address.isLoopbackAddress } ?: continue
        val nif = props.interfaceName?.let { runCatching { NetworkInterface.getByName(it) }.getOrNull() }
        return LanLink(n, nif, la.address as Inet4Address, la.prefixLength)
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
        val ia = nif.interfaceAddresses.firstOrNull { it.address is Inet4Address && it.address.isSiteLocalAddress } ?: continue
        return LanLink(null, nif, ia.address as Inet4Address, ia.networkPrefixLength.toInt())
      }
    } catch (e: Exception) {
      Log.w(TAG, "NetworkInterface lookup failed", e)
    }
    return null
  }

  fun toInt(a: Inet4Address): Int = a.address.fold(0) { acc, b -> (acc shl 8) or (b.toInt() and 0xff) }

  fun toAddress(i: Int): InetAddress =
    InetAddress.getByAddress(byteArrayOf((i ushr 24).toByte(), (i ushr 16).toByte(), (i ushr 8).toByte(), i.toByte()))

  /**
   * Host addresses of the subnet around [ip], excluding [ip], network and broadcast address.
   * Large subnets are narrowed to the /[minPrefix] block containing [ip] to keep scans short.
   */
  fun subnetHosts(ip: Int, prefixLength: Int, minPrefix: Int = 23): List<Int> {
    val prefix = prefixLength.coerceIn(minPrefix, 30)
    val mask = -1 shl (32 - prefix)
    val network = ip and mask
    val broadcast = network or mask.inv()
    return ((network + 1) until broadcast).filter { it != ip }
  }

  /** Directed broadcast address of the subnet (e.g. 192.168.1.255). */
  fun broadcastAddress(ip: Int, prefixLength: Int): Int {
    val prefix = prefixLength.coerceIn(8, 30)
    val mask = -1 shl (32 - prefix)
    return (ip and mask) or mask.inv()
  }
}

object SsdpDiscovery {
  private const val TAG = "SonosTubeSsdp"
  private const val SSDP_ADDR = "239.255.255.250"
  private const val SSDP_PORT = 1900
  private const val ST = "urn:schemas-upnp-org:device:ZonePlayer:1"

  /**
   * Blocking SSDP M-SEARCH for Sonos ZonePlayers. Returns [{ip, location}].
   *
   * Sent several times via multicast and broadcast on the Wi-Fi interface: many routers and mesh
   * systems drop or throttle multicast, and single UDP packets often get lost on Wi-Fi.
   */
  fun discover(context: Context, timeoutMs: Long): List<Map<String, Any?>> {
    val timeout = timeoutMs.coerceIn(500, 30_000)
    val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    val lock = wifi.createMulticastLock("SonosTube:ssdp").apply { setReferenceCounted(false) }
    val found = LinkedHashMap<String, String>()
    try {
      lock.acquire()
      MulticastSocket(null).use { socket ->
        socket.reuseAddress = true
        socket.bind(InetSocketAddress(0))
        val link = NetworkUtils.lanLink(context)
        // Route through Wi-Fi even when cellular is the default network.
        link?.network?.let { n -> runCatching { n.bindSocket(socket) }.onFailure { Log.w(TAG, "bindSocket failed", it) } }
        link?.nif?.let { nif -> runCatching { socket.networkInterface = nif }.onFailure { Log.w(TAG, "setNetworkInterface failed", it) } }
        socket.timeToLive = 4
        socket.broadcast = true
        val message = (
          "M-SEARCH * HTTP/1.1\r\n" +
            "HOST: $SSDP_ADDR:$SSDP_PORT\r\n" +
            "MAN: \"ssdp:discover\"\r\n" +
            "MX: 1\r\n" +
            "ST: $ST\r\n" +
            "\r\n"
          ).toByteArray(Charsets.US_ASCII)
        val targets = buildList {
          add(InetSocketAddress(InetAddress.getByName(SSDP_ADDR), SSDP_PORT))
          add(InetSocketAddress(InetAddress.getByName("255.255.255.255"), SSDP_PORT))
          link?.let { l ->
            add(InetSocketAddress(NetworkUtils.toAddress(NetworkUtils.broadcastAddress(NetworkUtils.toInt(l.address), l.prefixLength)), SSDP_PORT))
          }
        }
        val start = System.currentTimeMillis()
        val deadline = start + timeout
        val sendTimes = longArrayOf(0, 250, 700, 1400, 2200).filter { it < timeout - 300 || it == 0L }
        var sent = 0
        val buf = ByteArray(2048)
        while (true) {
          val now = System.currentTimeMillis()
          if (now >= deadline) break
          while (sent < sendTimes.size && now - start >= sendTimes[sent]) {
            for (target in targets) {
              try {
                socket.send(DatagramPacket(message, message.size, target))
              } catch (e: Exception) {
                Log.w(TAG, "M-SEARCH send to ${target.address} failed", e)
              }
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
            if (isSonosResponse(headers) && !found.containsKey(ip)) found[ip] = location
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

  fun isSonosResponse(headers: Map<String, String>): Boolean {
    val st = headers["st"] ?: ""
    val server = headers["server"] ?: ""
    return st.equals(ST, ignoreCase = true) || server.contains("sonos", ignoreCase = true) ||
      headers.containsKey("x-rincon-household")
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

/**
 * Last-resort discovery: probes TCP port 1400 (the Sonos control port) on every host of the Wi-Fi
 * subnet. Works when the network blocks multicast and broadcast entirely.
 */
object SubnetScan {
  private const val TAG = "SonosTubeScan"
  const val SONOS_PORT = 1400

  /** IPs that accepted a connection on port 1400, in subnet order. */
  fun scan(context: Context, connectTimeoutMs: Int): List<String> {
    val link = NetworkUtils.lanLink(context) ?: return emptyList()
    val hosts = NetworkUtils.subnetHosts(NetworkUtils.toInt(link.address), link.prefixLength)
    val factory = link.network?.socketFactory ?: SocketFactory.getDefault()
    val timeout = connectTimeoutMs.coerceIn(100, 3000)
    val pool = Executors.newFixedThreadPool(64)
    try {
      val futures = hosts.map { host ->
        pool.submit<String?> {
          val addr = NetworkUtils.toAddress(host)
          try {
            factory.createSocket().use { s ->
              s.connect(InetSocketAddress(addr, SONOS_PORT), timeout)
              addr.hostAddress
            }
          } catch (_: Exception) {
            null
          }
        }
      }
      return futures.mapNotNull { f -> runCatching { f.get() }.getOrNull() }
    } catch (e: Exception) {
      Log.w(TAG, "subnet scan failed", e)
      return emptyList()
    } finally {
      pool.shutdownNow()
    }
  }
}
