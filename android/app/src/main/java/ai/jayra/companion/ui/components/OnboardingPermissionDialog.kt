package ai.jayra.companion.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import ai.jayra.companion.theme.*

@Composable
fun OnboardingPermissionDialog(
    onGrantAll: () -> Unit,
    onOpenAccessibilitySettings: () -> Unit,
    onDismiss: () -> Unit
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(24.dp))
                .background(JayraNavySurface)
                .border(1.dp, BorderCyanGlowing, RoundedCornerShape(24.dp))
                .padding(24.dp)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                // Header badge
                Box(
                    modifier = Modifier
                        .size(52.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(JayraCyanSubtle)
                        .border(1.dp, JayraCyanPrimary, RoundedCornerShape(16.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.Security,
                        contentDescription = "Permissions",
                        tint = JayraCyanPrimary,
                        modifier = Modifier.size(28.dp)
                    )
                }

                Spacer(modifier = Modifier.height(14.dp))

                Text(
                    text = "DEVICE PERMISSIONS",
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                    letterSpacing = 1.5.sp,
                    color = TextWhitePrimary
                )

                Spacer(modifier = Modifier.height(6.dp))

                Text(
                    text = "To allow JAYRA to control phone apps, deliver alerts, and enable voice conversations, please authorize the following permissions:",
                    fontFamily = FontFamily.SansSerif,
                    fontSize = 12.sp,
                    lineHeight = 18.sp,
                    color = TextMuted
                )

                Spacer(modifier = Modifier.height(16.dp))

                // Permission row cards
                PermissionRow(
                    icon = Icons.Default.TouchApp,
                    title = "Accessibility Automation",
                    description = "Required to inspect screen hierarchies, click buttons, and launch apps upon desktop voice commands."
                )

                Spacer(modifier = Modifier.height(10.dp))

                PermissionRow(
                    icon = Icons.Default.Mic,
                    title = "Microphone & Audio",
                    description = "Stream your voice in real time directly to JAYRA's ReAct cognition core."
                )

                Spacer(modifier = Modifier.height(10.dp))

                PermissionRow(
                    icon = Icons.Default.Notifications,
                    title = "Push Notifications",
                    description = "Receive instant alerts when autonomous desktop tasks complete or require confirmation."
                )

                Spacer(modifier = Modifier.height(10.dp))

                PermissionRow(
                    icon = Icons.Default.QrCodeScanner,
                    title = "Camera (Pairing Only)",
                    description = "Scan your PC screen QR code for one-tap LAN bridge pairing."
                )

                Spacer(modifier = Modifier.height(22.dp))

                // Action Buttons
                Button(
                    onClick = onGrantAll,
                    colors = ButtonDefaults.buttonColors(containerColor = JayraCyanPrimary),
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier.fillMaxWidth().height(46.dp)
                ) {
                    Text(
                        text = "GRANT PERMISSIONS",
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        fontSize = 12.sp,
                        letterSpacing = 1.sp,
                        color = JayraOledBlack
                    )
                }

                Spacer(modifier = Modifier.height(8.dp))

                OutlinedButton(
                    onClick = onOpenAccessibilitySettings,
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = JayraCyanPrimary),
                    border = ButtonDefaults.outlinedButtonBorder.copy(brush = androidx.compose.ui.graphics.SolidColor(BorderCyanGlowing)),
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier.fillMaxWidth().height(42.dp)
                ) {
                    Text(
                        text = "OPEN ACCESSIBILITY SETTINGS",
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                        letterSpacing = 0.5.sp
                    )
                }

                Spacer(modifier = Modifier.height(6.dp))

                TextButton(onClick = onDismiss) {
                    Text(
                        text = "Skip for Now",
                        fontFamily = FontFamily.SansSerif,
                        fontSize = 11.sp,
                        color = TextMuted
                    )
                }
            }
        }
    }
}

@Composable
private fun PermissionRow(
    icon: ImageVector,
    title: String,
    description: String
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(JayraCardSurface)
            .border(1.dp, BorderSubtle, RoundedCornerShape(12.dp))
            .padding(10.dp),
        verticalAlignment = Alignment.Top
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = JayraCyanPrimary,
            modifier = Modifier.size(20.dp).padding(top = 2.dp)
        )
        Spacer(modifier = Modifier.width(10.dp))
        Column {
            Text(
                text = title,
                fontFamily = FontFamily.SansSerif,
                fontWeight = FontWeight.SemiBold,
                fontSize = 12.sp,
                color = TextWhitePrimary
            )
            Spacer(modifier = Modifier.height(2.dp))
            Text(
                text = description,
                fontFamily = FontFamily.SansSerif,
                fontSize = 11.sp,
                lineHeight = 15.sp,
                color = TextMuted
            )
        }
    }
}
