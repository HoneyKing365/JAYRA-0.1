package ai.jayra.companion.ui.components

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ai.jayra.companion.theme.*

@Composable
fun FluidStreamingText(
    text: String,
    isStreaming: Boolean,
    modifier: Modifier = Modifier
) {
    if (text.isEmpty() && !isStreaming) return

    val infiniteTransition = rememberInfiniteTransition(label = "cursor_blink")
    val cursorAlpha by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 0f,
        animationSpec = infiniteRepeatable(
            animation = tween(450, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "cursor_alpha"
    )

    Box(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(JayraCardSurface.copy(alpha = 0.85f))
            .border(1.dp, BorderCyanGlowing, RoundedCornerShape(18.dp))
            .padding(horizontal = 16.dp, vertical = 12.dp)
    ) {
        Column {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp)
            ) {
                Text(
                    text = "JAYRA LIVE SPEECH",
                    fontFamily = FontFamily.Monospace,
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.5.sp,
                    color = JayraCyanPrimary
                )
                if (isStreaming) {
                    Box(
                        modifier = Modifier
                            .size(6.dp)
                            .clip(RoundedCornerShape(3.dp))
                            .background(JayraEmeraldSuccess)
                    )
                }
            }

            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    text = text,
                    fontFamily = FontFamily.SansSerif,
                    fontSize = 14.sp,
                    lineHeight = 20.sp,
                    color = TextWhitePrimary,
                    modifier = Modifier.weight(1f, fill = false)
                )

                if (isStreaming) {
                    Box(
                        modifier = Modifier
                            .padding(start = 2.dp, bottom = 2.dp)
                            .size(width = 7.dp, height = 15.dp)
                            .background(JayraCyanPrimary.copy(alpha = cursorAlpha))
                    )
                }
            }
        }
    }
}
