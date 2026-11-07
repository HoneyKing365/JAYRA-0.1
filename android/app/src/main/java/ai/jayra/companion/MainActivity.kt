package ai.jayra.companion

import android.os.Bundle
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import ai.jayra.companion.theme.JayraCompanionTheme
import ai.jayra.companion.ui.MainScreen
import ai.jayra.companion.viewmodel.CompanionViewModel
import ai.jayra.companion.viewmodel.PermissionViewModel

class MainActivity : ComponentActivity() {

    private val companionViewModel: CompanionViewModel by viewModels()
    private val permissionViewModel: PermissionViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            JayraCompanionTheme {
                MainScreen(
                    companionViewModel = companionViewModel,
                    permissionViewModel = permissionViewModel
                )
            }
        }
        intent?.dataString?.let(companionViewModel::handlePairingQr)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.dataString?.let(companionViewModel::handlePairingQr)
    }

    override fun onResume() {
        super.onResume()
        permissionViewModel.refreshPermissions()
    }
}
