package ai.jayra.companion.model

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

@JsonClass(generateAdapter = true)
data class CharacterVisualState(
    @Json(name = "characterId") val characterId: String = "jayra_mark_lv",
    @Json(name = "characterName") val characterName: String = "JAYRA Hologram Core",
    @Json(name = "state") val state: String = "idle", // "idle", "listening", "speaking", "thinking"
    @Json(name = "emotion") val emotion: String = "neutral",
    @Json(name = "audioLevel") val audioLevel: Float = 0f,
    @Json(name = "themeColor") val themeColor: String = "cyan",
    @Json(name = "timestamp") val timestamp: Long = System.currentTimeMillis()
)

@JsonClass(generateAdapter = true)
data class ReActStage(
    @Json(name = "stage") val stage: String, // "Thought", "Action", "Observation"
    @Json(name = "iteration") val iteration: Int = 1,
    @Json(name = "maxIterations") val maxIterations: Int = 10,
    @Json(name = "status") val status: String? = null,
    @Json(name = "plan") val plan: String? = null,
    @Json(name = "action") val action: String? = null,
    @Json(name = "target") val target: String? = null,
    @Json(name = "details") val details: String? = null
)

data class TaskItem(
    val id: String,
    val goal: String,
    val state: String, // "running", "completed", "failed", "confirmation_required"
    val timestamp: Long = System.currentTimeMillis(),
    val stages: List<ReActStage> = emptyList()
)

data class ChatMessage(
    val id: String,
    val role: String, // "user", "model", "system"
    val text: String,
    val timestamp: Long = System.currentTimeMillis(),
    val isStreaming: Boolean = false
)

@JsonClass(generateAdapter = true)
data class HostCommandEnvelope(
    @Json(name = "type") val type: String = "command",
    @Json(name = "id") val id: String,
    @Json(name = "command") val command: Map<String, Any?>
)

@JsonClass(generateAdapter = true)
data class PhoneCommandResult(
    @Json(name = "type") val type: String = "command_result",
    @Json(name = "id") val id: String,
    @Json(name = "success") val success: Boolean,
    @Json(name = "result") val result: Any? = null,
    @Json(name = "error") val error: String? = null
)

@JsonClass(generateAdapter = true)
data class PhoneStatusPayload(
    @Json(name = "batteryPercent") val batteryPercent: Int?,
    @Json(name = "batteryCharging") val batteryCharging: Boolean?,
    @Json(name = "storageFreeBytes") val storageFreeBytes: Long?,
    @Json(name = "storageTotalBytes") val storageTotalBytes: Long?,
    @Json(name = "wifiState") val wifiState: String?,
    @Json(name = "wifiSsid") val wifiSsid: String?,
    @Json(name = "foregroundApp") val foregroundApp: String?
)

@JsonClass(generateAdapter = true)
data class InstalledAppInfo(
    @Json(name = "name") val name: String,
    @Json(name = "packageName") val packageName: String,
    @Json(name = "isSystem") val isSystem: Boolean = false
)

@JsonClass(generateAdapter = true)
data class AccessibilityNodeData(
    @Json(name = "viewId") val viewId: String? = null,
    @Json(name = "text") val text: String? = null,
    @Json(name = "contentDescription") val contentDescription: String? = null,
    @Json(name = "className") val className: String? = null,
    @Json(name = "bounds") val bounds: String? = null,
    @Json(name = "isClickable") val isClickable: Boolean = false,
    @Json(name = "isScrollable") val isScrollable: Boolean = false,
    @Json(name = "isEditable") val isEditable: Boolean = false,
    @Json(name = "children") val children: List<AccessibilityNodeData> = emptyList()
)

data class DailySummaryPayload(
    val date: String = "",
    val title: String = "",
    val focusMinutes: Int = 0,
    val focusHours: Float = 0f,
    val productivityScore: Int = 0,
    val vibeBaseline: String = "STEADY_VELOCITY",
    val sassySummary: Map<String, String> = emptyMap(),
    val recommendedTodos: List<String> = emptyList(),
    val topFiles: List<String> = emptyList(),
    val completedTasks: List<String> = emptyList(),
    val pendingTasks: List<String> = emptyList(),
    val timestamp: Long = System.currentTimeMillis()
)

data class CompanionLanguageSettings(
    val language: String = "en", // "en", "roman_urdu", "roman_hindi", "custom_script"
    val scriptStyle: String = "latin",
    val summaryLanguage: String = "multilingual",
    val dailyBoardSync: Boolean = true
)
