package ai.jayra.companion.viewmodel

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import ai.jayra.companion.model.CharacterVisualState
import ai.jayra.companion.model.ReActStage
import ai.jayra.companion.model.TaskItem
import ai.jayra.companion.net.FluidTextStreamingBuffer
import ai.jayra.companion.net.BridgeCredentialStore
import ai.jayra.companion.net.JayraBridgeClient
import ai.jayra.companion.net.LanDiscoveryManager
import ai.jayra.companion.service.AppLaunchManager
import ai.jayra.companion.service.DeviceControlManager
import ai.jayra.companion.ui.components.NavTab
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.security.GeneralSecurityException
import java.util.UUID

class CompanionViewModel(application: Application) : AndroidViewModel(application) {

    val appLaunchManager = AppLaunchManager(application)
    val deviceControlManager = DeviceControlManager(application)
    val lanDiscoveryManager = LanDiscoveryManager(application)
    private val credentialStore = BridgeCredentialStore(application)
    val streamingBuffer = FluidTextStreamingBuffer(viewModelScope)

    val bridgeClient = JayraBridgeClient(
        appLaunchManager = appLaunchManager,
        deviceControlManager = deviceControlManager,
        scope = viewModelScope
    )

    private val _selectedTab = MutableStateFlow(NavTab.COMPANION)
    val selectedTab = _selectedTab.asStateFlow()

    private val _activeTasks = MutableStateFlow<List<TaskItem>>(emptyList())
    val activeTasks = _activeTasks.asStateFlow()

    private val _latestReActStage = MutableStateFlow<ReActStage?>(null)
    val latestReActStage = _latestReActStage.asStateFlow()

    private val _isListening = MutableStateFlow(false)
    val isListening = _isListening.asStateFlow()

    val dailySummary = bridgeClient.dailySummaryEvents
    val languageSettings = bridgeClient.languageSettings

    var hostIp = "192.168.1.105"
        private set
    var port = 3000
        private set
    var bridgeToken = ""
        private set

    init {
        // Collect streaming transcriptions
        viewModelScope.launch {
            bridgeClient.transcriptionEvents.collect { (role, text) ->
                if (role == "model") {
                    streamingBuffer.appendChunk(text)
                }
            }
        }

        // Collect ReAct reasoning stages
        viewModelScope.launch {
            bridgeClient.reactEvents.collect { stage ->
                _latestReActStage.value = stage
                recordReActStage(stage)
            }
        }

        try {
            credentialStore.load()?.let { credentials ->
                hostIp = credentials.host
                port = credentials.port
                bridgeToken = credentials.token
                bridgeClient.connect(hostIp, port, bridgeToken)
            }
        } catch (error: GeneralSecurityException) {
            bridgeClient.reportConnectionError("Saved JAYRA pairing could not be decrypted: ${error.message}")
        } catch (error: IllegalArgumentException) {
            bridgeClient.reportConnectionError("Saved JAYRA pairing is invalid: ${error.message}")
        }
    }

    fun selectTab(tab: NavTab) {
        _selectedTab.value = tab
    }

    fun connect(ip: String, portNumber: Int, token: String) {
        if (token.isNotBlank()) {
            try {
                credentialStore.save(ip.trim(), portNumber, token.trim())
            } catch (error: GeneralSecurityException) {
                bridgeClient.reportConnectionError("Could not protect the JAYRA bridge token: ${error.message}")
                return
            } catch (error: IllegalArgumentException) {
                bridgeClient.reportConnectionError(error.message ?: "Invalid JAYRA pairing credentials.")
                return
            } catch (error: IllegalStateException) {
                bridgeClient.reportConnectionError(error.message ?: "Could not save JAYRA pairing credentials.")
                return
            }
        }
        hostIp = ip
        port = portNumber
        bridgeToken = token
        bridgeClient.connect(ip, portNumber, token)
    }

    fun handlePairingQr(content: String) {
        try {
            val trimmed = content.trim()
            if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
                val json = JSONObject(trimmed)
                val host = json.optString("host")
                val portNumber = json.optInt("port", 3000)
                val code = json.optString("code", json.optString("pairingCode"))
                val token = json.optString("token", json.optString("mobileBridgeToken"))
                if (code.matches(Regex("\\d{8}"))) {
                    pairWithCode(host, portNumber, code)
                } else if (token.isNotBlank()) {
                    connect(host, portNumber, token)
                } else {
                    throw IllegalArgumentException("The QR code does not contain a pairing code.")
                }
                return
            }

            val uri = Uri.parse(trimmed)
            if (uri.scheme == "jayra" && uri.host == "pair") {
                val host = uri.getQueryParameter("host")
                    ?.takeIf { it.isNotBlank() }
                    ?: throw IllegalArgumentException("The JAYRA pairing link is missing its host.")
                val portNumber = uri.getQueryParameter("port")?.toIntOrNull()
                    ?: throw IllegalArgumentException("The JAYRA pairing link has an invalid port.")
                val code = uri.getQueryParameter("code")
                    ?.takeIf { it.matches(Regex("\\d{8}")) }
                    ?: throw IllegalArgumentException("The JAYRA pairing link has an invalid code.")
                pairWithCode(host, portNumber, code)
                return
            }

            val host = uri.host ?: throw IllegalArgumentException("The QR code does not contain a JAYRA host.")
            val portNumber = if (uri.port in 1..65_535) uri.port else 3000
            val parameters = listOfNotNull(uri.query, uri.fragment).joinToString("&")
            val token = parameters.split("&")
                .firstOrNull { it.startsWith("mobileBridgeToken=") || it.startsWith("token=") }
                ?.substringAfter("=")
                ?.let { Uri.decode(it) }
                .orEmpty()
            if (token.isBlank()) throw IllegalArgumentException("The QR code does not contain a bridge token or pairing code.")
            connect(host, portNumber, token)
        } catch (error: IllegalArgumentException) {
            bridgeClient.reportConnectionError(error.message ?: "Invalid JAYRA pairing QR code.")
        } catch (error: org.json.JSONException) {
            bridgeClient.reportConnectionError("Invalid JAYRA pairing QR code: ${error.message}")
        }
    }

    private fun pairWithCode(host: String, portNumber: Int, code: String) {
        if (host.isBlank() || portNumber !in 1..65_535) {
            bridgeClient.reportConnectionError("The JAYRA pairing link has an invalid host or port.")
            return
        }
        bridgeClient.reportConnectionError("Pairing with JAYRA…")
        viewModelScope.launch {
            try {
                val token = bridgeClient.exchangePairingCode(host, portNumber, code)
                credentialStore.save(host, portNumber, token)
                hostIp = host
                port = portNumber
                bridgeToken = token
                bridgeClient.connect(host, portNumber, token)
            } catch (error: java.io.IOException) {
                bridgeClient.reportConnectionError(error.message ?: "JAYRA pairing failed.")
            } catch (error: GeneralSecurityException) {
                bridgeClient.reportConnectionError("Could not protect the JAYRA bridge token: ${error.message}")
            } catch (error: IllegalArgumentException) {
                bridgeClient.reportConnectionError(error.message ?: "Invalid JAYRA pairing credentials.")
            } catch (error: IllegalStateException) {
                bridgeClient.reportConnectionError(error.message ?: "Could not save JAYRA pairing credentials.")
            }
        }
    }

    fun sendTextCommand(text: String) {
        if (text.isBlank()) return
        streamingBuffer.reset()
        bridgeClient.sendTextCommand(text)

        // Log task
        val task = TaskItem(
            id = UUID.randomUUID().toString(),
            goal = text,
            state = "running",
            stages = emptyList()
        )
        _activeTasks.value = listOf(task) + _activeTasks.value
    }

    fun toggleVoiceListening() {
        val next = !_isListening.value
        _isListening.value = next
        if (next) {
            streamingBuffer.reset()
            val current = bridgeClient.characterState.value
            // Optimistic visual state
        }
    }

    fun handleQuickAction(action: String) {
        when (action) {
            "ringPhone" -> {
                deviceControlManager.triggerRingtoneFinder("ring", 20)
            }
            "getSystemTelemetry" -> {
                bridgeClient.sendRemoteDesktopAction("getSystemTelemetry")
            }
            "takeScreenshot" -> {
                bridgeClient.sendRemoteDesktopAction("takeScreenshot", mapOf("include_image" to true))
            }
            "mediaToggle" -> {
                deviceControlManager.controlMedia("toggle")
            }
        }
    }

    fun stopTask(taskId: String) {
        bridgeClient.sendRemoteDesktopAction("controlTask", mapOf("action" to "stop", "taskId" to taskId))
        _activeTasks.value = _activeTasks.value.map {
            if (it.id == taskId) it.copy(state = "stopped") else it
        }
    }

    fun discoverLanHost() {
        viewModelScope.launch {
            val result = lanDiscoveryManager.discoverHost()
            if (result.isSuccess) {
                val (ip, discoveredPort) = result.getOrThrow()
                connect(ip, discoveredPort, bridgeToken)
            }
        }
    }

    private fun recordReActStage(stage: ReActStage) {
        val current = _activeTasks.value
        if (current.isNotEmpty()) {
            val head = current[0]
            val updated = head.copy(stages = head.stages + stage)
            _activeTasks.value = listOf(updated) + current.drop(1)
        }
    }

    fun setLanguage(language: String) {
        bridgeClient.syncLanguagePreference(language)
    }

    fun refreshDailySummary(date: String = "") {
        bridgeClient.requestDailySummary(date)
    }

    override fun onCleared() {
        super.onCleared()
        bridgeClient.disconnect()
        deviceControlManager.stopRingtoneFinder()
    }
}
