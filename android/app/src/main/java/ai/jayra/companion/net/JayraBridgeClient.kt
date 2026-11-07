package ai.jayra.companion.net

import ai.jayra.companion.model.*
import ai.jayra.companion.service.AppLaunchManager
import ai.jayra.companion.service.DeviceControlManager
import ai.jayra.companion.service.JayraAccessibilityService
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

class JayraBridgeClient(
    private val appLaunchManager: AppLaunchManager,
    private val deviceControlManager: DeviceControlManager,
    private val scope: CoroutineScope
) {
    private val okHttpClient = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(15, TimeUnit.SECONDS)
        .build()

    private val moshi = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()

    private var liveWebSocket: WebSocket? = null
    private var phoneBridgeWebSocket: WebSocket? = null

    private val _isConnected = MutableStateFlow(false)
    val isConnected = _isConnected.asStateFlow()

    private val _connectionStatus = MutableStateFlow("Disconnected")
    val connectionStatus = _connectionStatus.asStateFlow()

    private val _characterState = MutableStateFlow(CharacterVisualState())
    val characterState = _characterState.asStateFlow()

    private val _reactEvents = MutableSharedFlow<ReActStage>(extraBufferCapacity = 64)
    val reactEvents = _reactEvents.asSharedFlow()

    private val _transcriptionEvents = MutableSharedFlow<Pair<String, String>>(extraBufferCapacity = 64)
    val transcriptionEvents = _transcriptionEvents.asSharedFlow() // role to text

    private val _dailySummaryEvents = MutableStateFlow<DailySummaryPayload?>(null)
    val dailySummaryEvents = _dailySummaryEvents.asStateFlow()

    private val _languageSettings = MutableStateFlow(CompanionLanguageSettings())
    val languageSettings = _languageSettings.asStateFlow()

    private var currentHostIp: String = "192.168.1.105"
    private var currentPort: Int = 3000
    private var currentBridgeToken: String = ""

    fun connect(hostIp: String, port: Int = 3000, bridgeToken: String = "") {
        currentHostIp = hostIp.trim()
        currentPort = port
        currentBridgeToken = bridgeToken.trim()

        disconnect()

        _connectionStatus.value = "Connecting to $currentHostIp:$currentPort..."
        connectLiveSocket()
        if (currentBridgeToken.isNotEmpty()) {
            connectPhoneBridgeSocket()
        }
    }

    fun reportConnectionError(message: String) {
        _isConnected.value = false
        _connectionStatus.value = message
    }

    suspend fun exchangePairingCode(hostIp: String, port: Int, code: String): String =
        withContext(Dispatchers.IO) {
            val requestBody = JSONObject().put("code", code)
                .toString()
                .toRequestBody("application/json; charset=utf-8".toMediaType())
            val request = Request.Builder()
                .url("http://$hostIp:$port/api/mobile/pair")
                .post(requestBody)
                .build()

            okHttpClient.newCall(request).execute().use { response ->
                val responseText = response.body?.string().orEmpty()
                val result = try {
                    JSONObject(responseText)
                } catch (error: org.json.JSONException) {
                    throw IOException("JAYRA returned an invalid pairing response.", error)
                }
                if (!response.isSuccessful || !result.optBoolean("paired")) {
                    throw IOException(result.optString("error").ifBlank { "JAYRA pairing failed (${response.code})." })
                }
                result.optString("bridgeToken")
                    .takeIf { it.matches(Regex("[a-fA-F0-9]{64}")) }
                    ?: throw IOException("JAYRA did not return a valid mobile bridge token.")
            }
        }

    private fun connectLiveSocket() {
        val request = Request.Builder()
            .url("ws://$currentHostIp:$currentPort/live")
            .header("Origin", "http://$currentHostIp:$currentPort")
            .build()

        liveWebSocket = okHttpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                _isConnected.value = true
                _connectionStatus.value = "Connected to JAYRA Master"
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleLiveSocketMessage(text)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                _isConnected.value = false
                _connectionStatus.value = "Live connection offline: ${t.localizedMessage ?: "Unknown"}"
                scheduleReconnect()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                _isConnected.value = false
                _connectionStatus.value = "Connection closed"
            }
        })
    }

    private fun connectPhoneBridgeSocket() {
        val request = Request.Builder()
            .url("ws://$currentHostIp:$currentPort/mobile-bridge")
            .header("X-JAYRA-Token", currentBridgeToken)
            .build()

        phoneBridgeWebSocket = okHttpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                // Identify phone device
                val identify = JSONObject().apply {
                    put("type", "identify")
                    put("name", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")
                    put("platform", "Android ${android.os.Build.VERSION.RELEASE} (API ${android.os.Build.VERSION.SDK_INT})")
                }
                webSocket.send(identify.toString())
                sendPhoneStatusUpdate()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handlePhoneBridgeCommand(text)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                // Background reconnection
            }
        })
    }

    private fun handleLiveSocketMessage(rawJson: String) {
        try {
            val json = JSONObject(rawJson)
            val type = json.optString("type")

            when (type) {
                "character_state_sync" -> {
                    val adapter = moshi.adapter(CharacterVisualState::class.java)
                    adapter.fromJson(rawJson)?.let { _characterState.value = it }
                }
                "reactStatus" -> {
                    val adapter = moshi.adapter(ReActStage::class.java)
                    adapter.fromJson(rawJson)?.let { _reactEvents.tryEmit(it) }
                }
                "transcription" -> {
                    val role = json.optString("role", "model")
                    val text = json.optString("text", "")
                    if (text.isNotEmpty()) {
                        _transcriptionEvents.tryEmit(Pair(role, text))
                    }
                }
                "audio" -> {
                    // Update audio pulse in visual state
                    val current = _characterState.value
                    if (current.state != "speaking") {
                        _characterState.value = current.copy(state = "speaking", audioLevel = 0.8f)
                    }
                }
                "turnComplete" -> {
                    val current = _characterState.value
                    _characterState.value = current.copy(state = "idle", audioLevel = 0f)
                }
                "interrupted" -> {
                    val current = _characterState.value
                    _characterState.value = current.copy(state = "listening", audioLevel = 0f)
                }
                "daily_summary_flashcard" -> {
                    val flashcardObj = json.optJSONObject("flashcard")
                    if (flashcardObj != null) {
                        val todos = mutableListOf<String>()
                        val todosArray = flashcardObj.optJSONArray("recommendedTodos")
                        if (todosArray != null) {
                            for (i in 0 until todosArray.length()) {
                                todos.add(todosArray.getString(i))
                            }
                        }
                        val sassyMap = mutableMapOf<String, String>()
                        val sassyObj = flashcardObj.optJSONObject("sassySummary")
                        if (sassyObj != null) {
                            val keys = sassyObj.keys()
                            while (keys.hasNext()) {
                                val k = keys.next()
                                sassyMap[k] = sassyObj.optString(k, "")
                            }
                        }
                        _dailySummaryEvents.value = DailySummaryPayload(
                            date = flashcardObj.optString("date", ""),
                            title = flashcardObj.optString("title", ""),
                            focusMinutes = flashcardObj.optInt("focusMinutes", 0),
                            focusHours = flashcardObj.optDouble("focusHours", 0.0).toFloat(),
                            productivityScore = flashcardObj.optInt("productivityScore", 0),
                            vibeBaseline = flashcardObj.optString("vibeBaseline", "STEADY_VELOCITY"),
                            sassySummary = sassyMap,
                            recommendedTodos = todos
                        )
                    }
                }
                "settings_sync" -> {
                    val lang = json.optString("language", "en")
                    val script = json.optString("scriptStyle", "latin")
                    val sumLang = json.optString("summaryLanguage", "multilingual")
                    val sync = json.optBoolean("dailyBoardSync", true)
                    _languageSettings.value = CompanionLanguageSettings(
                        language = lang,
                        scriptStyle = script,
                        summaryLanguage = sumLang,
                        dailyBoardSync = sync
                    )
                }
            }
        } catch (e: Exception) {
            // Ignore parse errors on malformed frames
        }
    }

    private fun handlePhoneBridgeCommand(rawJson: String) {
        scope.launch(Dispatchers.IO) {
            try {
                val json = JSONObject(rawJson)
                if (json.optString("type") != "command") return@launch

                val requestId = json.getString("id")
                val cmdObj = json.getJSONObject("command")
                val action = cmdObj.getString("action")

                val resultPayload = executeCommandLocally(action, cmdObj)
                sendAck(requestId, resultPayload.first, resultPayload.second)
            } catch (e: Exception) {
                // Malformed packet
            }
        }
    }

    private suspend fun executeCommandLocally(action: String, cmd: JSONObject): Pair<Boolean, Any?> {
        return when (action.uppercase()) {
            "LIST_INSTALLED_APPS" -> {
                val apps = appLaunchManager.listInstalledApps()
                Pair(true, mapOf("apps" to apps, "total" to apps.size))
            }
            "LAUNCH_APP" -> {
                val appName = cmd.optString("appName", "")
                val pkgName = cmd.optString("packageName", "")
                val launchResult = appLaunchManager.launchApp(appName.ifEmpty { pkgName }, pkgName.ifEmpty { null })
                Pair(launchResult.isSuccess, mapOf("message" to (launchResult.getOrNull() ?: launchResult.exceptionOrNull()?.message)))
            }
            "QUERY_PHONE_STATUS" -> {
                val status = deviceControlManager.queryPhoneStatus()
                Pair(true, status)
            }
            "TRIGGER_RINGTONE_FINDER" -> {
                val mode = cmd.optString("mode", "ring")
                val duration = cmd.optInt("durationSec", 30)
                val res = deviceControlManager.triggerRingtoneFinder(mode, duration)
                Pair(res.isSuccess, mapOf("active" to res.isSuccess, "durationSec" to duration))
            }
            "TRIGGER_NOTIFICATION" -> {
                val title = cmd.optString("title", "JAYRA Alert")
                val body = cmd.optString("body", "")
                val priority = cmd.optString("priority", "normal")
                val res = deviceControlManager.sendNotification(title, body, priority)
                Pair(res.isSuccess, mapOf("posted" to res.isSuccess))
            }
            "MEDIA_CONTROL" -> {
                val op = cmd.optString("operation", "toggle")
                val volume = if (cmd.has("volume")) cmd.getInt("volume") else null
                val res = deviceControlManager.controlMedia(op, volume)
                Pair(res.isSuccess, mapOf("operation" to op))
            }
            "INSPECT_SCREEN_HIERARCHY" -> {
                val service = JayraAccessibilityService.instance
                if (service == null) {
                    Pair(false, "Accessibility Service is not enabled in Android Settings.")
                } else {
                    val depth = cmd.optInt("maxDepth", 10)
                    val hierarchy = service.inspectScreenHierarchy(depth)
                    Pair(true, hierarchy)
                }
            }
            "ACCESSIBILITY_ACTION" -> {
                val service = JayraAccessibilityService.instance
                if (service == null) {
                    Pair(false, "Accessibility Service is not enabled.")
                } else {
                    val actionType = cmd.optString("actionType", "CLICK")
                    val target = cmd.optJSONObject("target")
                    val viewId = target?.optString("viewId")
                    val text = target?.optString("text")
                    val inputText = cmd.optString("text")
                    val x = if (cmd.has("x")) cmd.getDouble("x").toFloat() else null
                    val y = if (cmd.has("y")) cmd.getDouble("y").toFloat() else null
                    val res = service.performAction(actionType, viewId, text, inputText, x, y)
                    Pair(res.isSuccess, mapOf("result" to (res.getOrNull() ?: res.exceptionOrNull()?.message)))
                }
            }
            else -> Pair(false, "Unsupported command action: $action")
        }
    }

    private fun sendAck(requestId: String, success: Boolean, resultData: Any?) {
        val ack = JSONObject().apply {
            put("type", "command_result")
            put("id", requestId)
            put("success", success)
            if (success) {
                put("result", resultData)
            } else {
                put("error", resultData?.toString() ?: "Execution failure")
            }
        }
        phoneBridgeWebSocket?.send(ack.toString())
    }

    fun sendTextCommand(text: String) {
        val payload = JSONObject().apply {
            put("type", "text")
            put("text", text.trim())
        }
        liveWebSocket?.send(payload.toString())
    }

    fun syncLanguagePreference(language: String, scriptStyle: String = "latin") {
        _languageSettings.value = _languageSettings.value.copy(language = language, scriptStyle = scriptStyle)
        val payload = JSONObject().apply {
            put("type", "update_language_preference")
            put("language", language)
            put("scriptStyle", scriptStyle)
        }
        liveWebSocket?.send(payload.toString())
        phoneBridgeWebSocket?.send(payload.toString())
    }

    fun requestDailySummary(date: String = "") {
        val payload = JSONObject().apply {
            put("type", "request_daily_summary")
            if (date.isNotEmpty()) put("date", date)
        }
        liveWebSocket?.send(payload.toString())
    }

    fun sendRemoteDesktopAction(action: String, args: Map<String, Any?> = emptyMap()) {
        val payload = JSONObject().apply {
            put("type", "remote_action")
            put("action", action)
            put("args", JSONObject(args))
        }
        liveWebSocket?.send(payload.toString())
    }

    fun syncLanguagePreference(language: String, scriptStyle: String = "latin") {
        _languageSettings.value = _languageSettings.value.copy(language = language, scriptStyle = scriptStyle)
        val payload = JSONObject().apply {
            put("type", "update_language_preference")
            put("language", language)
            put("scriptStyle", scriptStyle)
        }
        liveWebSocket?.send(payload.toString())
        phoneBridgeWebSocket?.send(payload.toString())
    }

    fun requestDailySummary(date: String = "") {
        val payload = JSONObject().apply {
            put("type", "request_daily_summary")
            if (date.isNotEmpty()) put("date", date)
        }
        liveWebSocket?.send(payload.toString())
    }

    fun sendPhoneStatusUpdate() {
        val status = deviceControlManager.queryPhoneStatus()
        val adapter = moshi.adapter(PhoneStatusPayload::class.java)
        val jsonString = adapter.toJson(status)
        val envelope = JSONObject().apply {
            put("type", "status_update")
            put("status", JSONObject(jsonString))
        }
        phoneBridgeWebSocket?.send(envelope.toString())
    }

    private fun scheduleReconnect() {
        scope.launch {
            delay(5000)
            if (!_isConnected.value) {
                connect(currentHostIp, currentPort, currentBridgeToken)
            }
        }
    }

    fun disconnect() {
        liveWebSocket?.close(1000, "Client disconnect")
        phoneBridgeWebSocket?.close(1000, "Client disconnect")
        liveWebSocket = null
        phoneBridgeWebSocket = null
        _isConnected.value = false
        _connectionStatus.value = "Disconnected"
    }
}
