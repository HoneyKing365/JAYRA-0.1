package ai.jayra.companion.ui.tabs

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Circle
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Screenshot
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ai.jayra.companion.model.CharacterVisualState
import ai.jayra.companion.theme.*
import ai.jayra.companion.ui.components.FluidStreamingText
import ai.jayra.companion.ui.components.HolographicAvatar
import ai.jayra.companion.ui.components.VoiceTextDock

@Composable
fun CompanionTab(
    isConnected: Boolean,
    connectionStatus: String,
    characterState: CharacterVisualState,
    streamingText: String,
    isStreaming: Boolean,
    isListening: Boolean,
    onSendText: (String) -> Unit,
    onToggleMic: () -> Unit,
    onQuickAction: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(JayraOledBlack),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.SpaceBetween
    ) {
        // Top HUD Header Pill
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 16.dp, start = 16.dp, end = 16.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(JayraNavySurface)
                .border(1.dp, BorderSubtle, RoundedCornerShape(16.dp))
                .padding(horizontal = 14.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    text = characterState.characterName.uppercase(),
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    fontSize = 11.sp,
                    letterSpacing = 1.sp,
                    color = JayraCyanPrimary
                )
                Text(
                    text = "STATUS: ${characterState.state.uppercase()} • EMOTION: ${characterState.emotion.uppercase()}",
                    fontFamily = FontFamily.Monospace,
                    fontSize = 9.sp,
                    color = TextMuted
                )
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Default.Circle,
                    contentDescription = null,
                    tint = if (isConnected) JayraEmeraldSuccess else JayraAmberWarning,
                    modifier = Modifier.size(8.dp)
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = if (isConnected) "HOST ONLINE" else "OFFLINE",
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 10.sp,
                    color = if (isConnected) JayraEmeraldSuccess else JayraAmberWarning
                )
            }
        }

        // Center Synced Holographic Avatar
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentAlignment = Alignment.Center
        ) {
            HolographicAvatar(visualState = characterState)
        }

        // Subtitles & Fluid Streaming Dialogue Box
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 6.dp)
        ) {
            FluidStreamingText(
                text = streamingText,
                isStreaming = isStreaming
            )
        }

        // Quick Command Action Chips
        LazyRow(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            item {
                QuickActionChip(
                    icon = Icons.Default.PhoneAndroid,
                    label = "Ring Phone",
                    onClick = { onQuickAction("ringPhone") }
                )
            }
            item {
                QuickActionChip(
                    icon = Icons.Default.Computer,
                    label = "PC Telemetry",
                    onClick = { onQuickAction("getSystemTelemetry") }
                )
            }
            item {
                QuickActionChip(
                    icon = Icons.Default.Screenshot,
                    label = "PC Screenshot",
                    onClick = { onQuickAction("takeScreenshot") }
                )
            }
            item {
                QuickActionChip(
                    icon = Icons.Default.MusicNote,
                    label = "Media Toggle",
                    onClick = { onQuickAction("mediaToggle") }
                )
            }
        }

        // Fixed Voice & Text Input Dock
        VoiceTextDock(
            isListening = isListening,
            onSendText = onSendText,
            onToggleMic = onToggleMic
        )
    }
}

@Composable
private fun QuickActionChip(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(14.dp))
            .background(JayraCardSurface)
            .border(1.dp, BorderCyanGlowing, RoundedCornerShape(14.dp))
            .clickable { onClick() }
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = icon,
            contentDescription = label,
            tint = JayraCyanPrimary,
            modifier = Modifier.size(14.dp)
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text(
            text = label,
            fontFamily = FontFamily.Monospace,
            fontSize = 11.sp,
            color = TextWhitePrimary
        )
    }
}
