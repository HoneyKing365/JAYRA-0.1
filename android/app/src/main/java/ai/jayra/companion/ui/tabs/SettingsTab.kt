package ai.jayra.companion.ui.tabs

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ai.jayra.companion.model.AppPermissionItem
import ai.jayra.companion.theme.*

@Composable
fun SettingsTab(
    hostIp: String,
    port: Int,
    bridgeToken: String,
    permissions: List<AppPermissionItem>,
    currentLanguage: String = "en",
    onLanguageChange: (String) -> Unit = {},
    onSaveConnection: (String, Int, String) -> Unit,
    onLanDiscover: () -> Unit,
    onScanQr: () -> Unit,
    onRequestPermission: (AppPermissionItem) -> Unit,
    onOpenAccessibilitySettings: () -> Unit,
    modifier: Modifier = Modifier
) {
    var ipInput by remember { mutableStateOf(hostIp) }
    var portInput by remember { mutableStateOf(port.toString()) }
    var tokenInput by remember { mutableStateOf(bridgeToken) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(JayraOledBlack)
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
    ) {
        // Top Header
        Text(
            text = "SYSTEM CONFIGURATION",
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Bold,
            fontSize = 15.sp,
            letterSpacing = 1.sp,
            color = JayraCyanPrimary
        )
        Text(
            text = "Bridge Endpoints, Automation & Permission Hub",
            fontFamily = FontFamily.SansSerif,
            fontSize = 11.sp,
            color = TextMuted
        )

        Spacer(modifier = Modifier.height(16.dp))

        // 1. Connection & Pairing Card
        SectionCard(title = "DESKTOP BRIDGE CONNECTION") {
            // Host IP
            Text(text = "Host IP Address", fontFamily = FontFamily.Monospace, fontSize = 10.sp, color = TextMuted)
            Spacer(modifier = Modifier.height(4.dp))
            ConfigInput(value = ipInput, onValueChange = { ipInput = it }, placeholder = "192.168.1.105")

            Spacer(modifier = Modifier.height(10.dp))

            // Port
            Text(text = "Bridge Port", fontFamily = FontFamily.Monospace, fontSize = 10.sp, color = TextMuted)
            Spacer(modifier = Modifier.height(4.dp))
            ConfigInput(value = portInput, onValueChange = { portInput = it }, placeholder = "3000")

            Spacer(modifier = Modifier.height(10.dp))

            // Bridge Token
            Text(text = "Mobile Bridge Token (Private)", fontFamily = FontFamily.Monospace, fontSize = 10.sp, color = TextMuted)
            Spacer(modifier = Modifier.height(4.dp))
            ConfigInput(value = tokenInput, onValueChange = { tokenInput = it }, placeholder = "Paste pairing token")

            Spacer(modifier = Modifier.height(14.dp))

            // Action Buttons
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Button(
                    onClick = {
                        val parsedPort = portInput.toIntOrNull() ?: 3000
                        onSaveConnection(ipInput, parsedPort, tokenInput)
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = JayraCyanPrimary),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.weight(1f).height(42.dp)
                ) {
                    Text(
                        text = "CONNECT",
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        fontSize = 11.sp,
                        color = JayraOledBlack
                    )
                }

                OutlinedButton(
                    onClick = onScanQr,
                    border = ButtonDefaults.outlinedButtonBorder.copy(brush = SolidColor(BorderCyanGlowing)),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.height(42.dp)
                ) {
                    Icon(imageVector = Icons.Default.QrCodeScanner, contentDescription = "Scan QR", tint = JayraCyanPrimary, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(text = "SCAN QR", fontFamily = FontFamily.Monospace, fontSize = 10.sp, color = JayraCyanPrimary)
                }

                OutlinedButton(
                    onClick = onLanDiscover,
                    border = ButtonDefaults.outlinedButtonBorder.copy(brush = SolidColor(BorderCyanGlowing)),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.height(42.dp)
                ) {
                    Icon(imageVector = Icons.Default.WifiFind, contentDescription = "Discover", tint = JayraCyanPrimary, modifier = Modifier.size(16.dp))
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Language & Script Preferences Card
        SectionCard(title = "LANGUAGE & SCRIPT PREFERENCES") {
            Text(
                text = "Select preferred companion dialect. Synchronizes with desktop JAYRA Master deck.",
                fontFamily = FontFamily.SansSerif,
                fontSize = 11.sp,
                color = TextMuted
            )

            Spacer(modifier = Modifier.height(10.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                listOf(
                    Pair("en", "English"),
                    Pair("roman_urdu", "Roman Urdu"),
                    Pair("roman_hindi", "Roman Hindi")
                ).forEach { (code, label) ->
                    val isSelected = currentLanguage == code
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(10.dp))
                            .background(if (isSelected) JayraCyanPrimary.copy(alpha = 0.2f) else JayraNavySurface)
                            .border(1.dp, if (isSelected) JayraCyanPrimary else BorderSubtle, RoundedCornerShape(10.dp))
                            .clickable { onLanguageChange(code) }
                            .padding(vertical = 10.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = label,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                            fontSize = 10.sp,
                            color = if (isSelected) JayraCyanPrimary else TextLight
                        )
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        // 2. Persistent Permission Management Hub (Requirement 2)
        SectionCard(title = "DEVICE PERMISSIONS & PRIVILEGES") {
            Text(
                text = "Review granted device capabilities. Tapping an action requests OS authorization directly.",
                fontFamily = FontFamily.SansSerif,
                fontSize = 11.sp,
                color = TextMuted
            )

            Spacer(modifier = Modifier.height(12.dp))

            permissions.forEach { perm ->
                PermissionHubItem(
                    permission = perm,
                    onAction = {
                        if (perm.isAccessibilityService) {
                            onOpenAccessibilitySettings()
                        } else {
                            onRequestPermission(perm)
                        }
                    }
                )
                Spacer(modifier = Modifier.height(8.dp))
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        // 3. Diagnostics & Device Telemetry Card
        SectionCard(title = "COMPANION DIAGNOSTICS") {
            Text(
                text = "Engine: Gyra / JAYRA Master-Client Deck v3.0\nProtocol: WebSocket RPC & Event Streaming",
                fontFamily = FontFamily.Monospace,
                fontSize = 10.sp,
                lineHeight = 16.sp,
                color = TextMuted
            )
        }
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(JayraCardSurface)
            .border(1.dp, BorderCyanGlowing, RoundedCornerShape(16.dp))
            .padding(14.dp)
    ) {
        Text(
            text = title,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Bold,
            fontSize = 10.sp,
            letterSpacing = 1.sp,
            color = JayraCyanPrimary
        )
        Spacer(modifier = Modifier.height(10.dp))
        content()
    }
}

@Composable
private fun ConfigInput(value: String, onValueChange: (String) -> Unit, placeholder: String) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(JayraNavySurface)
            .border(1.dp, BorderSubtle, RoundedCornerShape(10.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp)
    ) {
        if (value.isEmpty()) {
            Text(text = placeholder, style = TextStyle(color = TextDim, fontSize = 12.sp, fontFamily = FontFamily.Monospace))
        }
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            textStyle = TextStyle(color = TextWhitePrimary, fontSize = 12.sp, fontFamily = FontFamily.Monospace),
            cursorBrush = SolidColor(JayraCyanPrimary),
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
    }
}

@Composable
private fun PermissionHubItem(
    permission: AppPermissionItem,
    onAction: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(JayraNavySurface)
            .border(1.dp, if (permission.isGranted) JayraEmeraldSuccess.copy(alpha = 0.3f) else JayraAmberWarning.copy(alpha = 0.3f), RoundedCornerShape(12.dp))
            .padding(10.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = permission.title,
                fontFamily = FontFamily.SansSerif,
                fontWeight = FontWeight.SemiBold,
                fontSize = 12.sp,
                color = TextWhitePrimary
            )
            Text(
                text = permission.description,
                fontFamily = FontFamily.SansSerif,
                fontSize = 10.sp,
                color = TextMuted
            )
        }

        Spacer(modifier = Modifier.width(8.dp))

        // Status Badge / Grant Button
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(8.dp))
                .background(if (permission.isGranted) JayraEmeraldGlow else JayraAmberWarning.copy(alpha = 0.15f))
                .border(1.dp, if (permission.isGranted) JayraEmeraldSuccess else JayraAmberWarning, RoundedCornerShape(8.dp))
                .clickable { onAction() }
                .padding(horizontal = 10.dp, vertical = 5.dp)
        ) {
            Text(
                text = if (permission.isGranted) "GRANTED" else "ACTION REQUIRED",
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Bold,
                fontSize = 9.sp,
                color = if (permission.isGranted) JayraEmeraldSuccess else JayraAmberWarning
            )
        }
    }
}
