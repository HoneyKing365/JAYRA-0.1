package ai.jayra.companion.net

import android.content.Context
import android.net.wifi.WifiManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.InetAddress
import java.net.MulticastSocket
import java.util.UUID

class LanDiscoveryManager(private val context: Context) {

    private val multicastGroup = "239.255.42.99"
    private val multicastPort = 45842

    suspend fun discoverHost(timeoutMs: Int = 3000): Result<Pair<String, Int>> = withContext(Dispatchers.IO) {
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        val lock = wifi?.createMulticastLock("JayraDiscoveryLock")?.apply { setReferenceCounted(true); acquire() }

        try {
            val group = InetAddress.getByName(multicastGroup)
            val socket = MulticastSocket(multicastPort).apply {
                soTimeout = timeoutMs
                joinGroup(group)
            }

            val nonce = UUID.randomUUID().toString()
            val query = JSONObject().apply {
                put("type", "jayra_discover")
                put("protocolVersion", 1)
                put("nonce", nonce)
            }.toString()

            val sendData = query.toByteArray()
            val packet = DatagramPacket(sendData, sendData.size, group, multicastPort)
            socket.send(packet)

            val buffer = ByteArray(2048)
            val receivePacket = DatagramPacket(buffer, buffer.size)

            val startTime = System.currentTimeMillis()
            while (System.currentTimeMillis() - startTime < timeoutMs) {
                try {
                    socket.receive(receivePacket)
                    val raw = String(receivePacket.data, 0, receivePacket.length)
                    val json = JSONObject(raw)
                    if (json.optString("type") == "jayra_host" && json.optString("nonce") == nonce) {
                        val port = json.optInt("port", 3000)
                        val hostAddress = receivePacket.address.hostAddress ?: "127.0.0.1"
                        return@withContext Result.success(Pair(hostAddress, port))
                    }
                } catch (e: Exception) {
                    break
                }
            }

            Result.failure(NoSuchElementException("No JAYRA desktop host discovered on local network"))
        } catch (e: Exception) {
            Result.failure(e)
        } finally {
            lock?.release()
        }
    }
}
