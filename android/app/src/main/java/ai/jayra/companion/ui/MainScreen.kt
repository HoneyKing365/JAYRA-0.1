package ai.jayra.companion.ui

import android.app.Activity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ai.jayra.companion.theme.JayraOledBlack
import ai.jayra.companion.ui.components.BottomNavBar
import ai.jayra.companion.ui.components.NavTab
import ai.jayra.companion.ui.components.OnboardingPermissionDialog
import ai.jayra.companion.ui.tabs.CompanionTab
import ai.jayra.companion.ui.tabs.SettingsTab
import ai.jayra.companion.ui.tabs.TasksTab
import ai.jayra.companion.viewmodel.CompanionViewModel
import ai.jayra.companion.viewmodel.PermissionViewModel
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

@Composable
fun MainScreen(
    companionViewModel: CompanionViewModel,
    permissionViewModel: PermissionViewModel
) {
    val context = LocalContext.current
    val selectedTab by companionViewModel.selectedTab.collectAsStateWithLifecycle()
    val isConnected by companionViewModel.bridgeClient.isConnected.collectAsStateWithLifecycle()
    val connectionStatus by companionViewModel.bridgeClient.connectionStatus.collectAsStateWithLifecycle()
    val characterState by companionViewModel.bridgeClient.characterState.collectAsStateWithLifecycle()
    val streamingText by companionViewModel.streamingBuffer.visibleText.collectAsStateWithLifecycle()
    val isStreaming by companionViewModel.streamingBuffer.isStreaming.collectAsStateWithLifecycle()
    val isListening by companionViewModel.isListening.collectAsStateWithLifecycle()
    val activeTasks by companionViewModel.activeTasks.collectAsStateWithLifecycle()
    val latestReActStage by companionViewModel.latestReActStage.collectAsStateWithLifecycle()
    val dailySummary by companionViewModel.dailySummary.collectAsStateWithLifecycle()
    val languageSettings by companionViewModel.languageSettings.collectAsStateWithLifecycle()

    val showOnboarding by permissionViewModel.showOnboarding.collectAsStateWithLifecycle()
    val permissions by permissionViewModel.permissions.collectAsStateWithLifecycle()

    // Permission launcher
    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions()
    ) {
        permissionViewModel.refreshPermissions()
    }

    // QR Scanner launcher
    val qrLauncher = rememberLauncherForActivityResult(contract = ScanContract()) { result ->
        val content = result.contents
        if (!content.isNullOrBlank()) {
            companionViewModel.handlePairingQr(content)
        }
    }

    Scaffold(
        bottomBar = {
            BottomNavBar(
                selectedTab = selectedTab,
                onTabSelected = { companionViewModel.selectTab(it) }
            )
        },
        containerColor = JayraOledBlack,
        modifier = Modifier.fillMaxSize()
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .background(JayraOledBlack)
        ) {
            when (selectedTab) {
                NavTab.COMPANION -> {
                    CompanionTab(
                        isConnected = isConnected,
                        connectionStatus = connectionStatus,
                        characterState = characterState,
                        streamingText = streamingText,
                        isStreaming = isStreaming,
                        isListening = isListening,
                        onSendText = { companionViewModel.sendTextCommand(it) },
                        onToggleMic = {
                            val micPerm = permissions.find { it.id == "microphone" }
                            if (micPerm?.isGranted == true) {
                                companionViewModel.toggleVoiceListening()
                            } else {
                                permissionLauncher.launch(arrayOf(android.Manifest.permission.RECORD_AUDIO))
                            }
                        },
                        onQuickAction = { companionViewModel.handleQuickAction(it) }
                    )
                }
                NavTab.TASKS -> {
                    TasksTab(
                        activeTasks = activeTasks,
                        latestReActStage = latestReActStage,
                        dailySummary = dailySummary,
                        onStopTask = { companionViewModel.stopTask(it) }
                    )
                }
                NavTab.SETTINGS -> {
                    SettingsTab(
                        hostIp = companionViewModel.hostIp,
                        port = companionViewModel.port,
                        bridgeToken = companionViewModel.bridgeToken,
                        permissions = permissions,
                        currentLanguage = languageSettings.language,
                        onLanguageChange = { companionViewModel.setLanguage(it) },
                        onSaveConnection = { ip, port, token ->
                            companionViewModel.connect(ip, port, token)
                        },
                        onLanDiscover = { companionViewModel.discoverLanHost() },
                        onScanQr = {
                            val options = ScanOptions().apply {
                                setPrompt("Scan JAYRA Desktop Pairing QR Code")
                                setBeepEnabled(true)
                                setOrientationLocked(true)
                            }
                            qrLauncher.launch(options)
                        },
                        onRequestPermission = { perm ->
                            perm.manifestPermission?.let {
                                permissionLauncher.launch(arrayOf(it))
                            }
                        },
                        onOpenAccessibilitySettings = {
                            permissionViewModel.openAccessibilitySettings(context)
                        }
                    )
                }
            }
        }

        // First-Launch Onboarding Dialog
        if (showOnboarding) {
            OnboardingPermissionDialog(
                onGrantAll = {
                    val needed = permissions.mapNotNull { it.manifestPermission }.toTypedArray()
                    if (needed.isNotEmpty()) {
                        permissionLauncher.launch(needed)
                    }
                    permissionViewModel.completeOnboarding()
                },
                onOpenAccessibilitySettings = {
                    permissionViewModel.openAccessibilitySettings(context)
                    permissionViewModel.completeOnboarding()
                },
                onDismiss = {
                    permissionViewModel.completeOnboarding()
                }
            )
        }
    }
}
