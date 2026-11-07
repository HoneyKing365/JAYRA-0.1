package ai.jayra.companion.viewmodel

import android.Manifest
import android.app.Application
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import ai.jayra.companion.model.AppPermissionItem
import ai.jayra.companion.service.JayraAccessibilityService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

class PermissionViewModel(application: Application) : AndroidViewModel(application) {

    private val prefs = application.getSharedPreferences("jayra_permissions", Context.MODE_PRIVATE)

    private val _showOnboarding = MutableStateFlow(false)
    val showOnboarding = _showOnboarding.asStateFlow()

    private val _permissions = MutableStateFlow<List<AppPermissionItem>>(emptyList())
    val permissions = _permissions.asStateFlow()

    init {
        val completed = prefs.getBoolean("onboarding_completed", false)
        refreshPermissions()
        _showOnboarding.value = !completed
    }

    fun refreshPermissions() {
        val app = getApplication<Application>()
        val list = mutableListOf<AppPermissionItem>()

        // 1. Accessibility Automation Service
        list.add(
            AppPermissionItem(
                id = "accessibility",
                title = "Accessibility Automation",
                description = "Inspect app UI hierarchies and execute remote click/scroll gestures.",
                isGranted = JayraAccessibilityService.isRunning,
                isRequired = true,
                isAccessibilityService = true
            )
        )

        // 2. Microphone
        val micGranted = ContextCompat.checkSelfPermission(app, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        list.add(
            AppPermissionItem(
                id = "microphone",
                title = "Microphone & Voice Audio",
                description = "Stream voice audio to JAYRA's ReAct cognition core.",
                isGranted = micGranted,
                isRequired = true,
                manifestPermission = Manifest.permission.RECORD_AUDIO
            )
        )

        // 3. Post Notifications (Android 13+)
        val notifGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(app, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
        list.add(
            AppPermissionItem(
                id = "notifications",
                title = "Push Notifications",
                description = "Receive task completion notices and remote alerts.",
                isGranted = notifGranted,
                isRequired = false,
                manifestPermission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) Manifest.permission.POST_NOTIFICATIONS else null
            )
        )

        // 4. Camera (QR Pairing)
        val cameraGranted = ContextCompat.checkSelfPermission(app, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        list.add(
            AppPermissionItem(
                id = "camera",
                title = "Camera (Desktop Pairing)",
                description = "Scan your PC screen QR code for one-tap LAN pairing.",
                isGranted = cameraGranted,
                isRequired = false,
                manifestPermission = Manifest.permission.CAMERA
            )
        )

        _permissions.value = list
    }

    fun completeOnboarding() {
        prefs.edit().putBoolean("onboarding_completed", true).apply()
        _showOnboarding.value = false
    }

    fun openAccessibilitySettings(context: Context) {
        val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }

    fun openAppSettings(context: Context) {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = android.net.Uri.fromParts("package", context.packageName, null)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }
}
